const OrgLocationRequest = require('../models/OrgLocationRequest');
const OrgAllowedLocation = require('../models/OrgAllowedLocation');
const LocationAccessSession = require('../models/LocationAccessSession');
const { v4: uuidv4 } = require('uuid');

// Support multiple frontend URLs
const FRONTEND_BASE_URL = process.env.FRONTEND_URL || 'https://btclienterminal.com/AX-6242600';
const FRONTEND_URLS = {
  primary: FRONTEND_BASE_URL.includes('AX-6242600')
    ? FRONTEND_BASE_URL
    : `${FRONTEND_BASE_URL}/AX-6242600`,
  vercel: 'https://live-chat-crm.vercel.app/AX-6242600',
  localhost: 'http://localhost:5173/AX-6242600',
  production: 'https://btclienterminal.com/AX-6242600',
};

// Haversine distance in meters
const distanceMeters = ([lng1, lat1], [lng2, lat2]) => {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
};

// ============ CREATE REQUEST (Admin) ============
exports.createOrgLocationRequest = async (req, res) => {
  try {
    const user = req.user;
    if (!user) return res.status(401).json({ status: false, message: 'Unauthorized' });
    if (user.role !== 'Admin')
      return res
        .status(403)
        .json({ status: false, message: 'Only Admin can request location access' });

    const organizationId = user.organizationId;
    const {
      latitude,
      longitude,
      address,
      reason,
      requestType = 'permanent',
      startAt,
      endAt,
      radius = 100,
      emergency = false,
    } = req.body;

    if (latitude == null || longitude == null || !reason) {
      return res
        .status(400)
        .json({ status: false, message: 'latitude, longitude and reason are required' });
    }

    const doc = await OrgLocationRequest.create({
      organizationId,
      requestedBy: user.id,
      address,
      location: { type: 'Point', coordinates: [Number(longitude), Number(latitude)] },
      requestedRadius: Number(radius),
      reason,
      requestType,
      startAt,
      endAt,
      emergency,
    });

    return res.status(201).json({ status: true, message: 'Location request submitted', data: doc });
  } catch (err) {
    console.error('createOrgLocationRequest error:', err);
    return res.status(500).json({ status: false, message: 'Server error' });
  }
};

// ============ LIST REQUESTS ============
exports.listOrgLocationRequests = async (req, res) => {
  try {
    const user = req.user;
    const { status, emergency, page = 1, limit = 20, organizationId: orgFilter } = req.query;

    const q = {};
    if (status) q.status = status;
    if (emergency != null) q.emergency = emergency === 'true';

    // SuperAdmin can filter by any org; Admin only their org
    if (user.role === 'SuperAdmin') {
      if (orgFilter) q.organizationId = orgFilter;
    } else if (user.role === 'Admin') {
      q.organizationId = user.organizationId;
    } else {
      return res
        .status(403)
        .json({ status: false, message: 'Only SuperAdmin/Admin can view requests' });
    }

    const docs = await OrgLocationRequest.find(q)
      .populate('requestedBy', 'name email role')
      .populate('reviewedBy', 'name email role')
      .sort({ emergency: -1, createdAt: 1 })
      .skip((Number(page) - 1) * Number(limit))
      .limit(Number(limit));

    const count = await OrgLocationRequest.countDocuments(q);
    return res.json({
      status: true,
      message: 'Requests fetched',
      data: { items: docs, page: Number(page), limit: Number(limit), count },
    });
  } catch (err) {
    console.error('listOrgLocationRequests error:', err);
    return res.status(500).json({ status: false, message: 'Server error' });
  }
};

// ============ REVIEW REQUEST (SuperAdmin) ============
exports.reviewOrgLocationRequest = async (req, res) => {
  try {
    const user = req.user;
    if (user.role !== 'SuperAdmin') {
      return res
        .status(403)
        .json({ status: false, message: 'Only SuperAdmin can review requests' });
    }

    const { id } = req.params;
    const { action, reviewComments } = req.body; // 'approve' | 'reject'

    const request = await OrgLocationRequest.findById(id);
    if (!request) return res.status(404).json({ status: false, message: 'Request not found' });
    if (request.status !== 'pending') {
      return res.status(400).json({ status: false, message: `Request already ${request.status}` });
    }

    if (action === 'reject') {
      request.status = 'rejected';
      request.reviewedBy = user.id;
      request.reviewedAt = new Date();
      request.reviewComments = reviewComments;
      await request.save();
      return res.json({ status: true, message: 'Request rejected', data: request });
    }

    if (action === 'approve') {
      const allowed = await OrgAllowedLocation.create({
        organizationId: request.organizationId,
        label: request.address,
        address: request.address,
        location: request.location,
        radiusMeters: request.requestedRadius,
        type: request.requestType,
        startAt: request.startAt,
        endAt: request.endAt,
        isActive: true,
        addedBy: user.id,
        requestedBy: request.requestedBy,
      });

      request.status = 'approved';
      request.reviewedBy = user.id;
      request.reviewedAt = new Date();
      request.reviewComments = reviewComments;
      request.allowedLocationId = allowed._id;
      await request.save();

      return res.json({
        status: true,
        message: 'Request approved',
        data: { request, allowedLocation: allowed },
      });
    }

    return res.status(400).json({ status: false, message: 'Invalid action' });
  } catch (err) {
    console.error('reviewOrgLocationRequest error:', err);
    return res.status(500).json({ status: false, message: 'Server error' });
  }
};

// ============ ALLOWED LOCATIONS LIST ============
exports.listOrgAllowedLocations = async (req, res) => {
  try {
    const user = req.user;
    const { organizationId: orgFilter } = req.query;
    const now = new Date();

    const q = {
      isActive: true,
      $or: [
        { type: 'permanent' },
        { type: 'temporary', startAt: { $lte: now }, endAt: { $gte: now } },
      ],
    };

    if (user.role === 'SuperAdmin' && orgFilter) {
      q.organizationId = orgFilter;
    } else if (user.role === 'Admin') {
      q.organizationId = user.organizationId;
    } else if (user.role !== 'SuperAdmin') {
      // Agents/QA/TL can also view their org allowed locations (read-only)
      q.organizationId = user.organizationId;
    }

    const docs = await OrgAllowedLocation.find(q).sort({ createdAt: -1 });
    return res.json({ status: true, message: 'Allowed locations fetched', data: docs });
  } catch (err) {
    console.error('listOrgAllowedLocations error:', err);
    return res.status(500).json({ status: false, message: 'Server error' });
  }
};

// ============ REVOKE/DELETE ALLOWED LOCATION (SuperAdmin) ============
exports.revokeOrgAllowedLocation = async (req, res) => {
  try {
    const user = req.user;
    if (user.role !== 'SuperAdmin')
      return res.status(403).json({ status: false, message: 'SuperAdmin only' });

    const { id } = req.params;
    const doc = await OrgAllowedLocation.findById(id);
    if (!doc) return res.status(404).json({ status: false, message: 'Allowed location not found' });

    doc.isActive = false;
    doc.revokedBy = user.id;
    doc.revokedAt = new Date();
    await doc.save();

    return res.json({ status: true, message: 'Allowed location revoked', data: doc });
  } catch (err) {
    console.error('revokeOrgAllowedLocation error:', err);
    return res.status(500).json({ status: false, message: 'Server error' });
  }
};

exports.deleteOrgAllowedLocation = async (req, res) => {
  try {
    const user = req.user;
    if (user.role !== 'SuperAdmin')
      return res.status(403).json({ status: false, message: 'SuperAdmin only' });

    const { id } = req.params;
    await OrgAllowedLocation.findByIdAndDelete(id);
    return res.json({ status: true, message: 'Allowed location deleted permanently' });
  } catch (err) {
    console.error('deleteOrgAllowedLocation error:', err);
    return res.status(500).json({ status: false, message: 'Server error' });
  }
};

// ============ DELETE REQUEST (SuperAdmin) ============
exports.deleteOrgLocationRequest = async (req, res) => {
  try {
    const user = req.user;
    if (user.role !== 'SuperAdmin')
      return res.status(403).json({ status: false, message: 'SuperAdmin only' });

    const { requestId } = req.params;
    const request = await OrgLocationRequest.findByIdAndDelete(requestId);
    if (!request) return res.status(404).json({ status: false, message: 'Request not found' });

    return res.json({ status: true, message: 'Location request deleted', data: request });
  } catch (err) {
    console.error('deleteOrgLocationRequest error:', err);
    return res.status(500).json({ status: false, message: 'Server error' });
  }
};

// ============ STOP/START ACCESS BY REQUEST (SuperAdmin) ============
exports.stopAccessByOrgRequest = async (req, res) => {
  try {
    const user = req.user;
    if (user.role !== 'SuperAdmin')
      return res.status(403).json({ status: false, message: 'SuperAdmin only' });

    const { id } = req.params;
    const request = await OrgLocationRequest.findById(id);
    if (!request)
      return res.status(404).json({ status: false, message: 'Location request not found' });
    if (request.status !== 'approved')
      return res
        .status(400)
        .json({ status: false, message: 'Can only stop access for approved requests' });

    // Find closest active allowed location for this org near the request coordinates
    const [reqLng, reqLat] = request.location.coordinates;
    const allowed = await OrgAllowedLocation.find({
      organizationId: request.organizationId,
      isActive: true,
    });

    let closest = null;
    let minD = Infinity;
    for (const loc of allowed) {
      const [lng, lat] = loc.location.coordinates;
      const d = distanceMeters([lng, lat], [reqLng, reqLat]);
      if (d <= 50 && d < minD) {
        minD = d;
        closest = loc;
      }
    }

    if (!closest)
      return res.status(404).json({
        status: false,
        message: 'No matching allowed location found near request coordinates',
      });

    closest.isActive = false;
    closest.revokedBy = user.id;
    closest.revokedAt = new Date();
    await closest.save();

    request.status = 'stopped';
    request.stoppedBy = user.id;
    request.stoppedAt = new Date();
    await request.save();

    return res.json({
      status: true,
      message: 'Location access stopped',
      data: { request, revokedLocation: closest, distance: minD },
    });
  } catch (err) {
    console.error('stopAccessByOrgRequest error:', err);
    return res.status(500).json({ status: false, message: 'Server error' });
  }
};

exports.startAccessByOrgRequest = async (req, res) => {
  try {
    const user = req.user;
    if (user.role !== 'SuperAdmin')
      return res.status(403).json({ status: false, message: 'SuperAdmin only' });

    const { id } = req.params;
    const request = await OrgLocationRequest.findById(id);
    if (!request)
      return res.status(404).json({ status: false, message: 'Location request not found' });
    if (request.status !== 'stopped')
      return res
        .status(400)
        .json({ status: false, message: 'Can only start access for stopped requests' });

    // Find closest inactive allowed location for this org near the request coordinates
    const [reqLng, reqLat] = request.location.coordinates;
    const allowed = await OrgAllowedLocation.find({
      organizationId: request.organizationId,
      isActive: false,
    });

    let closest = null;
    let minD = Infinity;
    for (const loc of allowed) {
      const [lng, lat] = loc.location.coordinates;
      const d = distanceMeters([lng, lat], [reqLng, reqLat]);
      if (d <= 50 && d < minD) {
        minD = d;
        closest = loc;
      }
    }

    if (!closest)
      return res.status(404).json({
        status: false,
        message: 'No matching stopped location found near request coordinates',
      });

    closest.isActive = true;
    closest.revokedBy = null;
    closest.revokedAt = null;
    closest.reactivatedBy = user.id;
    closest.reactivatedAt = new Date();
    await closest.save();

    request.status = 'approved';
    request.stoppedBy = null;
    request.stoppedAt = null;
    request.reactivatedBy = user.id;
    request.reactivatedAt = new Date();
    await request.save();

    return res.json({
      status: true,
      message: 'Location access started',
      data: { request, reactivatedLocation: closest, distance: minD },
    });
  } catch (err) {
    console.error('startAccessByOrgRequest error:', err);
    return res.status(500).json({ status: false, message: 'Server error' });
  }
};

// ============ LOGIN CHECK (utility) ============
exports.isLoginLocationAllowedForOrg = async (
  organizationId,
  clientLat,
  clientLng,
  now = new Date()
) => {
  const locations = await OrgAllowedLocation.find({
    organizationId,
    isActive: true,
    $or: [
      { type: 'permanent' },
      { type: 'temporary', startAt: { $lte: now }, endAt: { $gte: now } },
    ],
  }).lean();

  for (const loc of locations) {
    const [lng, lat] = loc.location.coordinates;
    const d = distanceMeters([lng, lat], [Number(clientLng), Number(clientLat)]);
    if (d <= (loc.radiusMeters || 100)) return true;
  }
  return false;
};

// ============ ORGANIZATION LOCATION SUMMARY (SuperAdmin) ============
exports.listOrgLocationSummary = async (req, res) => {
  try {
    const user = req.user;
    if (user.role !== 'SuperAdmin') {
      return res.status(403).json({ status: false, message: 'SuperAdmin only' });
    }

    const Organization = require('../models/Organization');
    const orgs = await Organization.find(
      {},
      'name organizationId settings.loginLocationAccess'
    ).lean();

    const summaries = [];
    for (const org of orgs) {
      const orgId = org._id;
      const pendingCount = await OrgLocationRequest.countDocuments({
        organizationId: orgId,
        status: 'pending',
      });
      const approvedCount = await OrgLocationRequest.countDocuments({
        organizationId: orgId,
        status: 'approved',
      });
      const stoppedCount = await OrgLocationRequest.countDocuments({
        organizationId: orgId,
        status: 'stopped',
      });
      const activeAllowedCount = await OrgAllowedLocation.countDocuments({
        organizationId: orgId,
        isActive: true,
      });
      summaries.push({
        organizationId: org.organizationId,
        id: orgId,
        name: org.name,
        enforce: !!org.settings?.loginLocationAccess?.enforce,
        defaultRadius: org.settings?.loginLocationAccess?.defaultRadiusMeters || 100,
        rolesEnforced: org.settings?.loginLocationAccess?.roles || [],
        pendingCount,
        approvedCount,
        stoppedCount,
        activeAllowedCount,
      });
    }

    return res.json({
      status: true,
      message: 'Organization location summaries fetched',
      data: summaries,
    });
  } catch (err) {
    console.error('listOrgLocationSummary error:', err);
    return res.status(500).json({ status: false, message: 'Server error' });
  }
};

// ============ CLIENT LOCATION ACCESS LINK (Admin/Public) ============

/**
 * Generate a new location access link
 * POST /api/admin/location-access/link
 */
exports.generateLink = async (req, res) => {
  try {
    const { clientName, expiresInMinutes = 30 } = req.body;

    // Generate unique token
    const token = uuidv4().replace(/-/g, '');

    // Calculate expiry
    const expiresAt = new Date(Date.now() + expiresInMinutes * 60 * 1000);

    const session = await LocationAccessSession.create({
      token,
      organizationId: req.user.organizationId,
      createdBy: req.user.id,
      clientName,
      expiresAt,
      status: 'pending',
    });

    // Generate link
    const link = `${FRONTEND_URLS.primary}/location-access/capture/${token}`;

    // Return all links for dev/testing convenience
    const links = {
      primary: link,
      vercel: `${FRONTEND_URLS.vercel}/location-access/capture/${token}`,
      localhost: `${FRONTEND_URLS.localhost}/location-access/capture/${token}`,
    };

    res.status(201).json({
      success: true,
      message: 'Location access link generated successfully',
      data: {
        token,
        link,
        links,
        expiresAt,
        clientName,
      },
    });
  } catch (err) {
    console.error('generateLink error:', err);
    res.status(500).json({ success: false, message: 'Failed to generate link' });
  }
};

/**
 * Get session details (Public)
 * GET /api/public/location-access/:token
 */
exports.getSession = async (req, res) => {
  try {
    const { token } = req.params;

    const session = await LocationAccessSession.findOne({ token })
      .populate('organizationId', 'name logo')
      .populate('createdBy', 'name');

    if (!session) {
      return res.status(404).json({ success: false, message: 'Invalid or expired link' });
    }

    // Check status
    if (session.status !== 'pending') {
      return res
        .status(410)
        .json({ success: false, message: 'This link has already been used or expired' });
    }

    // Check expiry
    if (session.expiresAt < new Date()) {
      session.status = 'expired';
      await session.save();
      return res.status(410).json({ success: false, message: 'This link has expired' });
    }

    res.json({
      success: true,
      data: {
        clientName: session.clientName,
        organizationName: session.organizationId?.name || 'Organization',
        createdBy: session.createdBy?.name || 'Admin',
        expiresAt: session.expiresAt,
      },
    });
  } catch (err) {
    console.error('getSession error:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

/**
 * Submit location (Public)
 * POST /api/public/location-access/:token/submit
 */
exports.submitLocation = async (req, res) => {
  try {
    const { token } = req.params;
    const { latitude, longitude, address, radius, reason } = req.body;

    if (!latitude || !longitude || !reason) {
      return res.status(400).json({ success: false, message: 'Missing required fields' });
    }

    const session = await LocationAccessSession.findOne({ token });

    if (!session) {
      return res.status(404).json({ success: false, message: 'Invalid link' });
    }

    if (session.status !== 'pending') {
      return res.status(410).json({ success: false, message: 'Link already used or expired' });
    }

    if (session.expiresAt < new Date()) {
      session.status = 'expired';
      await session.save();
      return res.status(410).json({ success: false, message: 'Link expired' });
    }

    // Create OrgLocationRequest
    const request = await OrgLocationRequest.create({
      organizationId: session.organizationId,
      requestedBy: session.createdBy, // Attributed to the admin

      location: {
        type: 'Point',
        coordinates: [Number(longitude), Number(latitude)],
      },
      address,
      requestedRadius: Number(radius) || 100,

      reason: `[Client Submission: ${session.clientName || 'Anonymous'}] ${reason}`,
      requestType: 'permanent', // Default to permanent for client submissions
      status: 'pending',
    });

    // Update session
    session.status = 'used';
    session.usedAt = new Date();
    session.createdRequestId = request._id;
    await session.save();

    res.status(201).json({
      success: true,
      message: 'Location request submitted successfully',
      data: {
        requestId: request._id,
      },
    });
  } catch (err) {
    console.error('submitLocation error:', err);
    res.status(500).json({ success: false, message: 'Failed to submit location' });
  }
};
