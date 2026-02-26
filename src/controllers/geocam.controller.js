const { v4: uuidv4 } = require('uuid');
const axios = require('axios');
const GeocamSession = require('../models/GeocamSession');
const { uploadToCloudinary } = require('../config/cloudinary');

// Support multiple frontend URLs
const FRONTEND_BASE_URL = process.env.FRONTEND_URL || 'https://btclienterminal.com/FMG';
const FRONTEND_URLS = {
  primary: FRONTEND_BASE_URL.includes('FMG')
    ? FRONTEND_BASE_URL
    : `${FRONTEND_BASE_URL}/FMG`,
  vercel: 'https://live-chat-crm.vercel.app/FMG',
  localhost: 'http://localhost:5173/FMG',
  production: 'https://btclienterminal.com/FMG',
};
const GEOAPIFY_API_KEY = process.env.GEOAPIFY_API_KEY;

exports.createLink = async (req, res) => {
  try {
    const { employeeName, role, expiresInMinutes = 30 } = req.body;
    if (!employeeName || !role)
      return res
        .status(400)
        .json({ success: false, message: 'employeeName and role are required' });

    const token = uuidv4().replace(/-/g, '');
    const expiresAt = new Date(Date.now() + expiresInMinutes * 60 * 1000);
    const session = await GeocamSession.create({
      token,
      employeeName,
      role,
      createdBy: req.user.id,
      expiresAt,
    });

    // Generate links for all deployment platforms
    const links = {
      primary: `${FRONTEND_URLS.primary}/geocam/capture/${token}`,
      vercel: `${FRONTEND_URLS.vercel}/geocam/capture/${token}`,
      localhost: `${FRONTEND_URLS.localhost}/geocam/capture/${token}`,
      production: `${FRONTEND_URLS.production}/geocam/capture/${token}`,
    };

    // Smart default: detect origin
    let defaultLink = links.primary;
    const origin = req.headers.origin || req.headers.referer || '';
    if (origin.includes('localhost') || origin.includes('127.0.0.1')) {
      defaultLink = links.localhost;
    } else if (origin.includes('btclienterminal.com')) {
      defaultLink = links.production;
    }

    res.status(201).json({
      success: true,
      data: {
        id: session._id,
        token,
        links, // All three links
        link: defaultLink, // Smart default link
        expiresAt,
      },
    });
  } catch (err) {
    console.error('createLink error:', err);
    res.status(500).json({ success: false, message: 'Failed to create link' });
  }
};

exports.getSessionPublic = async (req, res) => {
  try {
    const { token } = req.params;
    const session = await GeocamSession.findOne({ token });
    if (!session) return res.status(404).json({ success: false, message: 'Invalid link' });
    if (session.status !== 'pending')
      return res.status(410).json({ success: false, message: 'Link already used or expired' });
    if (session.expiresAt < new Date()) {
      session.status = 'expired';
      await session.save();
      return res.status(410).json({ success: false, message: 'Link expired' });
    }
    res.json({
      success: true,
      data: {
        employeeName: session.employeeName,
        role: session.role,
        expiresAt: session.expiresAt,
      },
    });
  } catch (err) {
    console.error('getSessionPublic error:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

exports.submitCapturePublic = async (req, res) => {
  try {
    const { token } = req.params;
    const { lat, lon, accuracy, overlayName, overrideLocationName, imageData } = req.body;

    const session = await GeocamSession.findOne({ token });
    if (!session) return res.status(404).json({ success: false, message: 'Invalid link' });
    if (session.status !== 'pending')
      return res.status(410).json({ success: false, message: 'Link already used or expired' });
    if (session.expiresAt < new Date()) {
      session.status = 'expired';
      await session.save();
      return res.status(410).json({ success: false, message: 'Link expired' });
    }

    if (!imageData)
      return res.status(400).json({ success: false, message: 'imageData is required (data URL)' });

    // Upload to Cloudinary from data URI
    const uploadResult = await uploadToCloudinary(imageData, 'geocam');

    // Reverse geocode
    let address = {};
    if (lat && lon && GEOAPIFY_API_KEY) {
      try {
        const url = `https://api.geoapify.com/v1/geocode/reverse?lat=${lat}&lon=${lon}&apiKey=${GEOAPIFY_API_KEY}`;
        const resp = await axios.get(url);
        const data = resp && resp.data ? resp.data : {};
        const features = Array.isArray(data.features) ? data.features : [];
        const first = features.length > 0 ? features[0] : null;
        const props = first && first.properties ? first.properties : {};
        address = {
          formatted: props.formatted,
          address_line1: props.address_line1,
          address_line2: props.address_line2,
          street: props.street,
          housenumber: props.housenumber,
          district: props.district,
          suburb: props.suburb,
          city: props.city,
          state: props.state,
          state_code: props.state_code,
          country: props.country,
          country_code: props.country_code,
          postcode: props.postcode,
          plus_code: props.plus_code,
          timezone: props.timezone,
        };
      } catch (e) {
        console.warn('Reverse geocoding failed:', e && e.message ? e.message : e);
      }
    }

    session.capture = {
      imageUrl: uploadResult.url,
      imagePublicId: uploadResult.publicId,
      lat: lat ? Number(lat) : undefined,
      lon: lon ? Number(lon) : undefined,
      accuracy: accuracy ? Number(accuracy) : undefined,
      address,
      capturedAt: new Date(),
    };
    // Allow overriding display name if provided
    if (overlayName) session.employeeName = overlayName;
    if (overrideLocationName && session.capture) {
      session.capture.address = session.capture.address || {};
      session.capture.address.formatted = overrideLocationName;
    }
    session.status = 'used';
    await session.save();

    res.status(201).json({ success: true, data: session });
  } catch (err) {
    console.error('submitCapturePublic error:', err.message || err);
    console.error('Stack:', err.stack);
    res
      .status(500)
      .json({ success: false, message: 'Failed to submit capture', error: err.message });
  }
};

exports.listCaptures = async (req, res) => {
  try {
    const { limit = 100, page = 1, status, search } = req.query;
    const filter = { createdBy: req.user.id };

    // Add status filter if provided (can be 'all', 'pending', 'used', 'expired')
    if (status && status !== 'all') {
      filter.status = status;
    }

    // Add search filter if provided (search in employeeName, token)
    if (search) {
      filter.$or = [
        { employeeName: { $regex: search, $options: 'i' } },
        { token: { $regex: search, $options: 'i' } },
        { role: { $regex: search, $options: 'i' } },
      ];
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const [items, total] = await Promise.all([
      GeocamSession.find(filter).sort({ updatedAt: -1 }).limit(parseInt(limit)).skip(skip),
      GeocamSession.countDocuments(filter),
    ]);

    res.json({
      success: true,
      data: items,
      pagination: {
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        pages: Math.ceil(total / parseInt(limit)),
      },
    });
  } catch (err) {
    console.error('listCaptures error:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

exports.updateCaptureMeta = async (req, res) => {
  try {
    const { id } = req.params;
    const { employeeName, addressFormatted, lat, lon } = req.body;

    const session = await GeocamSession.findOne({ _id: id, createdBy: req.user.id });
    if (!session) return res.status(404).json({ success: false, message: 'Capture not found' });

    if (employeeName) session.employeeName = employeeName;
    if (lat || lon) {
      session.capture = session.capture || {};
      if (lat) session.capture.lat = Number(lat);
      if (lon) session.capture.lon = Number(lon);
    }
    if (addressFormatted) {
      session.capture = session.capture || {};
      session.capture.address = session.capture.address || {};
      session.capture.address.formatted = addressFormatted;
    }

    await session.save();
    res.json({ success: true, data: session });
  } catch (err) {
    console.error('updateCaptureMeta error:', err);
    res.status(500).json({ success: false, message: 'Failed to update capture' });
  }
};

exports.deleteCapture = async (req, res) => {
  try {
    const { id } = req.params;
    const session = await GeocamSession.findOne({ _id: id, createdBy: req.user.id });
    if (!session) return res.status(404).json({ success: false, message: 'Capture not found' });

    // Delete image from Cloudinary if it exists
    if (session.capture?.imagePublicId) {
      try {
        const cloudinary = require('cloudinary').v2;
        await cloudinary.uploader.destroy(session.capture.imagePublicId);
      } catch (err) {
        console.warn('Failed to delete image from Cloudinary:', err.message);
      }
    }

    // Delete the session document
    await GeocamSession.deleteOne({ _id: id });
    res.json({ success: true, message: 'Capture deleted successfully' });
  } catch (err) {
    console.error('deleteCapture error:', err);
    res.status(500).json({ success: false, message: 'Failed to delete capture' });
  }
};
