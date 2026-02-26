const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const User = require('../models/User');
const Organization = require('../models/Organization');
const DailyActivity = require('../models/DailyActivity');
const transporter = require('../config/emailConfig');
const generateEmailOtp = require('../utils/generateEmailOtp');
const getIndiaTime = require('../utils/timezone');
const { default: axios } = require('axios');
const { getClientIp, getLocation } = require('../utils/ipLocation');
const { uploadToCloudinary, deleteFromCloudinary } = require('../config/cloudinary');
const { format } = require('date-fns');
const { encryptPassword } = require('../utils/encryption');

//------------------< CREATE USER >------------------//
exports.register = async (req, res) => {
  try {
    const { user_name, name, department, tier, mobile, email, password, role, employee_id } =
      req.body;

    if (!user_name || !name || !mobile || !email || !password) {
      return res.status(400).json({ message: 'All fields are mandatory', status: false });
    }

    // Check if employee_id is required for non-Customer roles
    if (role !== 'Customer' && !employee_id) {
      return res.status(400).json({
        message: 'Employee ID is required for employee roles',
        status: false,
      });
    }

    // ✅ Get organizationId from logged-in user (Admin/Agent/QA)
    const creatorOrganizationId = req.user?.organizationId;
    const creatorRole = req.user?.role;

    // Debug logging
    console.log('🔍 Register Employee - Creator Info:', {
      userId: req.user?.id,
      role: creatorRole,
      organizationId: creatorOrganizationId,
      hasOrgId: !!creatorOrganizationId,
    });

    // ✅ Validate that creator has organizationId (not SuperAdmin)
    if (!creatorOrganizationId) {
      return res.status(400).json({
        message:
          'Your account is not linked to an organization. Please contact SuperAdmin to assign your account to an organization.',
        status: false,
      });
    }

    // ✅ Prevent Admin from creating another Admin role
    if (creatorRole === 'Admin' && role === 'Admin') {
      return res.status(403).json({
        message: 'Admin users can create Agent, QA, and TL roles (not Admin)',
        status: false,
      });
    }

    // ✅ Check if trying to create another Admin in same organization
    if (role === 'Admin') {
      const existingAdmin = await User.findOne({
        role: 'Admin',
        organizationId: creatorOrganizationId,
      });
      if (existingAdmin) {
        return res.status(400).json({
          message: 'An Admin already exists for this organization. Cannot create another Admin.',
          status: false,
        });
      }
    }

    // ✅ Validate tier/department for eligible roles
    const rolesRequiringTier = ['Agent', 'QA', 'TL'];
    if (rolesRequiringTier.includes(role)) {
      if (!department) {
        return res.status(400).json({
          message: 'Department is required for Agent, QA and TL roles',
          status: false,
        });
      }
      if (!tier) {
        return res.status(400).json({
          message: 'Tier is required for Agent, QA and TL roles',
          status: false,
        });
      }
    }

    // ✅ Check duplicate email within the same organization
    const existingUser = await User.findOne({
      email,
      organizationId: creatorOrganizationId,
    });
    if (existingUser) {
      return res.status(400).json({
        message: `User with this email already exists in your organization.`,
        status: false,
      });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const encryptedPass = encryptPassword(password); // Store encrypted version for admin viewing

    // Upload profile image to Cloudinary if provided OR accept pre-uploaded URL/publicId
    let profileImage = 'not available';
    let cloudinaryPublicId = null;

    if (req.file) {
      try {
        console.log('📤 Uploading profile image to Cloudinary...');
        const cloudinaryResult = await uploadToCloudinary(req.file.buffer, 'profile-images');
        profileImage = cloudinaryResult.url;
        cloudinaryPublicId = cloudinaryResult.publicId;
        console.log('✅ Profile image uploaded to Cloudinary:', profileImage);
      } catch (cloudError) {
        console.error('Cloudinary upload error:', cloudError);
        return res.status(500).json({ message: 'Failed to upload profile image', status: false });
      }
    } else if (req.body?.profileImageUrl) {
      // Accept already uploaded Cloudinary image from Geocam
      profileImage = req.body.profileImageUrl;
      if (req.body.profileImagePublicId) {
        cloudinaryPublicId = req.body.profileImagePublicId;
      }
    }

    const newAuthor = await User.create({
      user_name,
      name,
      mobile,
      email,
      department,
      tier: rolesRequiringTier.includes(role) ? tier : null,
      alias: rolesRequiringTier.includes(role) ? req.body.alias : null, // Add alias for Agent/TL/QA
      organizationId: creatorOrganizationId, // ✅ Set organizationId from creator
      createdBy: req.user?.id,
      password: hashedPassword,
      encryptedPassword: encryptedPass, // Store encrypted password for admin viewing
      visiblePassword: password, // Store plain text password for recovery
      role,
      employee_id,
      profileImage,
      cloudinaryPublicId,
      locationName: req.body.location || null,
    });

    return res.status(201).json({ message: 'SignUp successful!', status: true, data: newAuthor });
  } catch (error) {
    console.error('Error in register:', error);
    return res.status(500).json({
      message: 'Failed to create employee',
      status: false,
      error: error?.message,
    });
  }
};
//------------------< UPDATE PROFILE >------------------//
exports.updateProfile = async (req, res) => {
  try {
    const userId = req.user?.id;

    // Check if userId is provided
    if (!userId) {
      return res.status(400).json({ message: 'User ID is required', status: false });
    }

    // Safely destructure fields from the request body
    const {
      user_name,
      name,
      mobile,
      email,
      alias,
      locationCity,
      locationRegion,
      locationCountry,
      ip,
      locationTimezone,
    } = req.body;

    // Find the user in the database
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ message: 'User not found', status: false });
    }

    // Update fields if provided
    user.user_name = user_name || user.user_name;
    user.name = name || user.name;
    user.mobile = mobile || user.mobile;
    user.email = email || user.email;

    // Update alias for Agent/TL/QA roles
    if (alias !== undefined && ['Agent', 'TL', 'QA'].includes(user.role)) {
      user.alias = alias;
    }

    // Update editable location fields if provided
    if (locationCity || locationRegion || locationCountry || ip || locationTimezone) {
      user.location = user.location || {};
      if (locationCity) user.location.city = locationCity;
      if (locationRegion) user.location.region = locationRegion;
      if (locationCountry) user.location.country = locationCountry;
      if (locationTimezone) user.location.timezone = locationTimezone;
      if (ip) user.ip = ip; // top-level ip field in schema
    }

    // Handle profile image upload to Cloudinary
    if (req.file) {
      try {
        // Delete old image from Cloudinary if it exists
        if (user.cloudinaryPublicId) {
          console.log('🗑️ Deleting old profile image from Cloudinary:', user.cloudinaryPublicId);
          try {
            await deleteFromCloudinary(user.cloudinaryPublicId);
            console.log('✅ Old profile image deleted from Cloudinary');
          } catch (deleteError) {
            console.error('Error deleting old image:', deleteError);
            // Continue even if delete fails
          }
        }

        // Upload new image to Cloudinary
        console.log('📤 Uploading profile image to Cloudinary...');
        const cloudinaryResult = await uploadToCloudinary(req.file.buffer, 'profile-images');
        user.profileImage = cloudinaryResult.url;
        user.cloudinaryPublicId = cloudinaryResult.publicId;
        console.log('✅ Profile image uploaded to Cloudinary:', user.profileImage);
      } catch (cloudError) {
        console.error('Cloudinary upload error:', cloudError);
        return res.status(500).json({ message: 'Failed to upload profile image', status: false });
      }
    }

    // Save the updated user data to the database
    const updatedUser = await user.save({ validateModifiedOnly: true });

    return res.status(200).json({
      message: 'Profile updated successfully!',
      status: true,
      data: updatedUser,
    });
  } catch (error) {
    console.error('Error in updateProfile:', error);
    return res.status(500).json({ message: 'Internal Server Error', status: false });
  }
};
//------------------< USER PROFILE >------------------//
exports.getProfile = async (req, res) => {
  try {
    const userId = req.user?.id;
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ message: 'User not found', status: false, data: null });
    }

    // Note: Removed auto-fix logic that was setting offline users to active.
    // The login function is the proper place to set status to active.
    // This was causing issues where logged-out users would get reset to active
    // when the frontend made API calls before fully redirecting.

    res.status(200).json({
      message: 'Profile fetched successfully',
      status: true,
      data: user,
    });
  } catch (error) {
    console.error('Error fetching profile:', error.message);
    res.status(500).json({ message: 'Internal server error', status: false, data: null });
  }
};
//------------------< DELETE ACCOUNT >------------------//
exports.deleteAccount = async (req, res) => {
  try {
    const id = req.params?.id;

    // ✅ Get organizationId from logged-in admin
    const adminOrganizationId = req.user?.organizationId;

    // First find the user to check organization
    const user = await User.findById(id);
    if (!user) {
      return res.status(404).json({ message: 'User not found', status: false, data: null });
    }

    // ✅ If admin has organizationId, verify the user belongs to same organization
    if (adminOrganizationId && user.organizationId?.toString() !== adminOrganizationId.toString()) {
      return res.status(403).json({
        message: 'You can only delete employees from your organization',
        status: false,
      });
    }

    // Delete the user
    await User.findByIdAndDelete(id);

    res.status(200).json({ message: 'account deleted', status: true, data: user });
  } catch (error) {
    console.error('Error deleting user:', error.message);
    return res.status(500).json({ message: 'Internal server error', status: false });
  }
};
//------------------< ALL USER >------------------//
exports.getAllAgents = async (req, res) => {
  try {
    const user = await User.find({ role: 'Agent' });
    // If no data found, return 404
    if (!user.length === 0) {
      return res.status(404).json({ message: 'No data found for user.' });
    }
    // Send successful response with user
    return res.status(200).json({ message: 'All user finded', data: user });
  } catch (error) {
    // Log the error and send a 500 status code
    console.error('Error fetching user:', error);
    return res.status(500).json({ message: 'Failed to fetch user. Please try again later.' });
  }
};

//------------------< ALL Customer >------------------//
exports.getAllCustomer = async (req, res) => {
  try {
    const user = await User.find({ role: 'Customer' });
    // If no data found, return 404
    if (!user) {
      return res.status(404).json({ message: 'No data found for user.' });
    }
    // Send successful response with user
    return res.status(200).json({ message: 'All customer finded', data: user });
  } catch (error) {
    // Log the error and send a 500 status code
    console.error('Error fetching user:', error);
    return res.status(500).json({ message: 'Failed to fetch user. Please try again later.' });
  }
};
//------------------< LOGIN >------------------//
exports.loginUser = async (req, res) => {
  try {
    const ip = getClientIp(req);
    const location = getLocation(ip);

    console.log('User IP:', ip);
    console.log('User Location:', location);

    const { email, employee_id, password, latitude, longitude } = req.body;

    console.log('Login Request Body:', {
      email,
      employee_id,
      hasPassword: !!password,
    });

    if (!password) {
      return res.status(400).json({ status: false, message: 'Password is required.' });
    }

    let user;

    // // 🔹 Try employee_id first if provided, then fallback to email
    // if (employee_id && employee_id.trim()) {
    //   console.log("Searching by employee_id:", employee_id.trim());
    //   user = await User.findOne({ employee_id: employee_id.trim() });
    //   console.log("User found by employee_id:", !!user);
    // }

    // // If no user found by employee_id, or no employee_id provided, try email
    // if (!user && email) {
    //   console.log("Searching by email:", email);
    //   user = await User.findOne({ email });
    //   console.log("User found by email:", !!user, user ? `Role: ${user.role}` : '');
    // }

    // Sanitization
    let empId = employee_id && typeof employee_id === 'string' ? employee_id.trim() : null;
    if (empId === 'undefined' || empId === 'null') empId = null;

    const cleanEmail = email && typeof email === 'string' ? email.trim() : null;

    console.log('Sanitized Login Inputs:', { empId, cleanEmail });

    // 🔹 If no email provided at all, reject immediately
    if (!cleanEmail) {
      return res.status(400).json({ status: false, message: 'Email is required.' });
    }

    // 🔹 Case 1: Email only (no employee_id) → try SuperAdmin login first, then email-only login
    if (!empId) {
      console.log('Attempting login with email only');
      // Try SuperAdmin first
      user = await User.findOne({
        email: { $regex: new RegExp(`^${cleanEmail}$`, 'i') },
        role: 'SuperAdmin',
      });
      if (user) {
        console.log('✅ SuperAdmin found by email');
      } else {
        // Also try Admin login by email only
        user = await User.findOne({
          email: { $regex: new RegExp(`^${cleanEmail}$`, 'i') },
          role: 'Admin',
        });
        if (user) console.log('✅ Admin found by email');
        else console.log('❌ No user found with email only');
      }
    }

    // 🔹 Case 2: Both employee_id AND email provided → search any role
    if (!user && empId && cleanEmail) {
      console.log('Searching by both employee_id AND email:', { empId, cleanEmail });
      user = await User.findOne({
        employee_id: empId,
        email: { $regex: new RegExp(`^${cleanEmail}$`, 'i') },
      });
      console.log('Result by employee_id + email:', user ? 'Found' : 'Not Found');
    }

    if (!user) {
      console.log('❌ No user found for credentials - returning 401');
      return res.status(401).json({ status: false, message: 'Invalid credentials.' });
    }

    // ✅ Check if account is blocked (ONLY for Agent/TL/QA, NOT Admin)
    console.log(
      '🔍 Login Check - isBlocked:',
      user.isBlocked,
      'failedLoginAttempts:',
      user.failedLoginAttempts,
      'failedIpAttempts:',
      user.failedIpAttempts
    );

    if (user.role !== 'Admin' && user.isBlocked) {
      console.log('❌ Account is blocked - returning 403');
      return res.status(403).json({
        status: false,
        message:
          'Account blocked due to multiple failed login attempts. Please contact Administrator.',
        blocked: true,
      });
    }

    // ✅ Verify password
    const passwordMatch = await bcrypt.compare(password, user.password);
    console.log('🔐 Password Match:', passwordMatch, 'for user:', user.email);

    if (!passwordMatch) {
      // ⚠️ Password blocking ONLY for Agent/TL/QA, NOT for Admin
      if (user.role !== 'Admin') {
        // Increment failed attempts
        user.failedLoginAttempts = (user.failedLoginAttempts || 0) + 1;
        console.log('❌ Wrong password - failedLoginAttempts now:', user.failedLoginAttempts);

        if (user.failedLoginAttempts >= 3) {
          // Block account on 3rd failed attempt
          user.isBlocked = true;
          user.blockedAt = getIndiaTime();
          user.blockedReason = 'Multiple failed login attempts';
          await user.save({ validateModifiedOnly: true });

          return res.status(403).json({
            status: false,
            message:
              'Account blocked due to 3 failed login attempts. Please contact Administrator.',
            blocked: true,
          });
        }

        await user.save({ validateModifiedOnly: true });

        const attemptsLeft = 3 - user.failedLoginAttempts;
        return res.status(401).json({
          status: false,
          message: `Wrong password. ${attemptsLeft} attempt${
            attemptsLeft !== 1 ? 's' : ''
          } remaining before account is blocked.`,
          attemptsLeft,
        });
      } else {
        // Admin - just return wrong password without counting attempts
        console.log('❌ Wrong password for Admin - no blocking');
        return res.status(401).json({
          status: false,
          message: 'Wrong password. Please try again.',
        });
      }
    }

    // ✅ Password correct - reset failed attempts (only for Agent/TL/QA)
    if (user.role !== 'Admin' && user.failedLoginAttempts > 0) {
      user.failedLoginAttempts = 0;
      // Don't await to avoid slowing login
      user
        .save({ validateModifiedOnly: true })
        .catch((err) => console.error('Failed to reset login attempts:', err));
    }

    // ==================== REMOVED OLD SINGLE-IP CHECK ====================
    // ✅ Now using Organization IP Configuration which supports multiple IPs
    // The check is done below in the Organization IP-Based Access Control section

    // ==================== ORGANIZATION IP-BASED ACCESS CONTROL (NOT Admin) ====================
    try {
      // Check IP restrictions for agents, QA, and team leaders (NOT Admin)
      const userRole = user.role;
      const restrictedRoles = ['Agent', 'TL', 'QA', 'agent', 'teamleader', 'tl', 'qa'];

      if (userRole !== 'Admin' && restrictedRoles.includes(userRole)) {
        const OrganizationIpConfig = require('../models/OrganizationIpConfig');

        // Skip IP check for localhost/development IPs
        const isLocalhost = ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(ip);

        console.log('🔒 Organization IP Access Check:', {
          userId: user._id,
          userName: user.name,
          userRole: user.role,
          organizationId: user.organizationId,
          clientIp: ip,
          isLocalhost,
          currentFailedIpAttempts: user.failedIpAttempts || 0,
        });

        if (!isLocalhost) {
          const ipCheck = await OrganizationIpConfig.verifyOrgIpAccess(
            user.organizationId,
            userRole,
            ip
          );

          console.log('🔍 Organization IP Verification Result:', ipCheck);

          // Block if config is inactive
          if (!ipCheck.allowed && ipCheck.reason === 'config_inactive') {
            console.log('🚫 [LOGIN BLOCKED] IP Config is INACTIVE - blocking all access');

            // Increment failed IP attempts
            user.failedIpAttempts = (user.failedIpAttempts || 0) + 1;

            if (user.failedIpAttempts >= 3) {
              user.isBlocked = true;
              user.blockedAt = getIndiaTime();
              user.blockedReason = 'Multiple login attempts from unauthorized IP address';
              await user.save({ validateModifiedOnly: true });

              console.log(`🚫 Account blocked for ${user.name} due to 3 IP mismatch attempts`);

              return res.status(403).json({
                status: false,
                message:
                  'Account blocked due to multiple login attempts from unauthorized IP address. Please contact Administrator to unblock your ID.',
                blocked: true,
                reason: 'ip_mismatch',
              });
            }

            await user.save({ validateModifiedOnly: true });
            const attemptsLeft = 3 - user.failedIpAttempts;

            return res.status(403).json({
              status: false,
              message: `Access denied. Organization IP configuration is currently disabled. ${attemptsLeft} attempt${
                attemptsLeft !== 1 ? 's' : ''
              } remaining before account is blocked.`,
              attemptsLeft,
              details: {
                yourIp: ip,
                reason: 'IP configuration is inactive',
                hint: 'Please ask your administrator to activate the IP configuration',
                allowedIps: [],
              },
            });
          }

          // Block if IP is not in allowed list (with attempt tracking)
          if (!ipCheck.allowed && ipCheck.reason === 'ip_not_allowed') {
            console.log('🚫 [LOGIN BLOCKED] User:', user.name, 'Role:', userRole, 'IP:', ip);
            console.log('🚫 [LOGIN BLOCKED] Allowed IPs:', ipCheck.allowedIps);

            // Increment failed IP attempts
            user.failedIpAttempts = (user.failedIpAttempts || 0) + 1;

            if (user.failedIpAttempts >= 3) {
              user.isBlocked = true;
              user.blockedAt = getIndiaTime();
              user.blockedReason = 'Multiple login attempts from unauthorized IP address';
              await user.save({ validateModifiedOnly: true });

              console.log(`🚫 Account blocked for ${user.name} due to 3 IP mismatch attempts`);

              return res.status(403).json({
                status: false,
                message:
                  'Account blocked due to multiple login attempts from unauthorized IP address. Please contact Administrator to unblock your ID.',
                blocked: true,
                reason: 'ip_mismatch',
              });
            }

            await user.save({ validateModifiedOnly: true });
            const attemptsLeft = 3 - user.failedIpAttempts;

            return res.status(403).json({
              status: false,
              message: `Access denied. Your IP address (${ip}) is not authorized. Allowed IPs: ${ipCheck.allowedIps.join(
                ', '
              )}. ${attemptsLeft} attempt${
                attemptsLeft !== 1 ? 's' : ''
              } remaining before account is blocked.`,
              attemptsLeft,
              details: {
                yourIp: ip,
                reason: 'IP address not in organization allowed list',
                hint: 'Please connect from an authorized network or contact your administrator',
                allowedIps: ipCheck.allowedIps || [],
              },
            });
          }

          // ✅ IP is ALLOWED - reset failed IP attempts if any
          if (ipCheck.allowed) {
            console.log(
              `✅ [IP ALLOWED] ${
                ipCheck.reason === 'ip_allowed' ? 'IP in allowed list' : ipCheck.reason
              }`
            );

            // Reset failed IP attempts on successful IP match
            if (user.failedIpAttempts > 0) {
              user.failedIpAttempts = 0;
              console.log(`✅ IP matched for ${user.name} - reset failedIpAttempts`);
              // Don't await to avoid slowing login
              user
                .save({ validateModifiedOnly: true })
                .catch((err) => console.error('Failed to reset IP attempts:', err));
            }
          }
        } else {
          console.log('⚠️ Localhost detected - IP check bypassed for development');

          // Reset failed IP attempts for localhost too
          if (user.failedIpAttempts > 0) {
            user.failedIpAttempts = 0;
            user
              .save({ validateModifiedOnly: true })
              .catch((err) => console.error('Failed to reset IP attempts:', err));
          }
        }
      }
    } catch (ipErr) {
      console.error('Organization IP verification error during login:', ipErr);
      // Continue with login if IP check fails (to avoid lockout due to system errors)
      // Admin can investigate and fix IP configuration separately
    }

    // ==================== LOCATION-BASED LOGIN ENFORCEMENT (NOT Admin) ====================
    try {
      // Enforce only for organization employees (Agent, QA, TL) when org has enabled it - NOT Admin
      if (user.role !== 'SuperAdmin' && user.role !== 'Admin' && user.organizationId) {
        const Organization = require('../models/Organization');
        const OrgAllowedLocation = require('../models/OrgAllowedLocation');

        const org = await Organization.findById(user.organizationId).select(
          'settings.loginLocationAccess'
        );
        const loginCfg = org?.settings?.loginLocationAccess || {};

        const enforce = !!loginCfg.enforce;
        const enforcedRoles =
          Array.isArray(loginCfg.roles) && loginCfg.roles.length
            ? loginCfg.roles
            : ['Admin', 'Agent', 'QA', 'TL'];
        const staffRoles = ['Agent', 'QA', 'TL'];
        // New rule: For TL, AGENT, QA -> they can only login if org has at least one approved location,
        // and they must be inside an approved radius. This applies even if org-wide enforce is false.
        const mustCheckForStaff = staffRoles.includes(user.role);
        const mustCheckByPolicy = enforce && enforcedRoles.includes(user.role);

        if (mustCheckForStaff || mustCheckByPolicy) {
          // Need current, active allowed locations for org
          const now = new Date();
          const allowed = await OrgAllowedLocation.find({
            organizationId: user.organizationId,
            isActive: true,
            $or: [
              { type: 'permanent' },
              {
                type: 'temporary',
                startAt: { $lte: now },
                endAt: { $gte: now },
              },
            ],
          }).lean();

          if (!allowed.length) {
            return res.status(403).json({
              status: false,
              message: mustCheckForStaff
                ? 'Your organization has not configured login location access yet. Please contact your Admin.'
                : 'Login location not approved yet for your organization. Please contact SuperAdmin.',
            });
          }

          // Require browser-provided geolocation
          const hasCoords =
            latitude != null && longitude != null && latitude !== '' && longitude !== '';
          if (!hasCoords) {
            return res.status(400).json({
              status: false,
              message:
                'Location required. Please allow location access in your browser and try again.',
            });
          }

          const clientLat = Number(latitude);
          const clientLng = Number(longitude);
          const reportedAccuracy =
            req.body?.accuracyMeters != null ? Number(req.body.accuracyMeters) : null;
          if (Number.isNaN(clientLat) || Number.isNaN(clientLng)) {
            return res.status(400).json({ status: false, message: 'Invalid location coordinates' });
          }

          // Haversine check within radius
          const toRad = (d) => (d * Math.PI) / 180;
          const distanceMeters = ([lng1, lat1], [lng2, lat2]) => {
            const R = 6371000;
            const dLat = toRad(lat2 - lat1);
            const dLng = toRad(lng2 - lng1);
            const a =
              Math.sin(dLat / 2) ** 2 +
              Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
            return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
          };

          let within = false;
          let nearestDistance = Infinity;
          let nearestRadius = null;
          let nearestLoc = null;
          for (const loc of allowed) {
            const [lng, lat] = loc.location.coordinates;
            const d = distanceMeters([lng, lat], [clientLng, clientLat]);
            const baseRadius = loc.radiusMeters || loginCfg.defaultRadiusMeters || 100;
            const tolerance = Number(loginCfg.toleranceMeters || 25); // base grace for GPS jitter
            // If the browser reports low accuracy, add a capped cushion to reduce false negatives
            const dynamicCushion =
              reportedAccuracy && reportedAccuracy > 50 ? Math.min(reportedAccuracy - 50, 150) : 0;
            const effectiveRadius = baseRadius + tolerance + dynamicCushion;
            if (d < nearestDistance) {
              nearestDistance = d;
              nearestRadius = baseRadius;
              nearestLoc = loc;
            }
            if (d <= effectiveRadius) {
              within = true;
              break;
            }
          }

          if (!within) {
            return res.status(403).json({
              status: false,
              message: 'Login not allowed from your current location.',
              nearestDistanceMeters: Math.round(nearestDistance),
              nearestAllowedRadiusMeters: nearestRadius,
              toleranceAppliedMeters: Number(loginCfg.toleranceMeters || 25),
              reportedAccuracyMeters: reportedAccuracy,
              clientCoordinates: { latitude: clientLat, longitude: clientLng },
              nearestAllowedLocation: nearestLoc
                ? {
                    id: nearestLoc._id,
                    label: nearestLoc.label || null,
                    address: nearestLoc.address || null,
                    coordinates: nearestLoc.location?.coordinates
                      ? {
                          latitude: nearestLoc.location.coordinates[1],
                          longitude: nearestLoc.location.coordinates[0],
                        }
                      : null,
                    radiusMeters: nearestLoc.radiusMeters || null,
                    isActive: !!nearestLoc.isActive,
                  }
                : null,
            });
          }
        }
      }
    } catch (locErr) {
      console.error('Login location enforcement error:', locErr);
      // Fail closed or open? Safer to fail closed when feature is enabled but an error occurs reading data
      // However, to avoid lockout due to transient DB issues, we proceed but log.
    }

    // ========== START NEW SESSION (DAY-WISE RESET) ==========
    // Every login starts a completely fresh session
    const now = getIndiaTime();

    user.is_active = true;
    user.workStatus = 'active'; // Auto-start active session
    user.login_time = now;
    user.logout_time = null;
    user.break_time = null;
    user.breakLogs = []; // Reset breaks for this session

    // Initialize Active Time Tracking
    user.accumulatedActiveTime = 0;
    user.lastStatusChangeTime = now;

    user.location = location;
    await user.save({ validateModifiedOnly: true });

    console.log(
      `✅ User logged in: ${user.name} (${user.email}) - Status: Active (Session Started)`
    );

    // Get organization name if user has organizationId
    let organizationName = null;
    if (user.organizationId) {
      const Organization = require('../models/Organization');
      const org = await Organization.findById(user.organizationId).select('name');
      organizationName = org?.name;
    } else if (user.role === 'Admin') {
      // ⚠️ Warning: Admin without organization
      console.warn('⚠️ WARNING: Admin user logged in without organizationId:', {
        userId: user._id,
        email: user.email,
        name: user.name,
        role: user.role,
      });
    }

    // Generate Token with organization info
    const tokenPayload = {
      id: user._id,
      role: user.role,
      name: user.name,
      alias: user.alias || null,
      organizationId: user.organizationId || null,
      organizationName: organizationName || null,
    };

    console.log('[DEBUG] JWT Token Payload:', JSON.stringify(tokenPayload, null, 2));

    const token = jwt.sign(tokenPayload, process.env.ACCESS_TOKEN_SECRET, {
      expiresIn: '7d',
    });

    return res.status(200).json({
      status: true,
      message: 'Login successful',
      token,
      data: user,
    });
  } catch (error) {
    console.error('Login Error:', error.message);
    return res.status(500).json({ status: false, message: 'Server Error. Please try again.' });
  }
};

//------------------< ACCEPT TERMS & CONDITIONS >------------------//
exports.acceptTerms = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ status: false, message: 'Unauthorized' });
    }

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ status: false, message: 'User not found' });
    }

    // Only enforce for employee roles (Admin, Agent, QA, TL)
    const enforcedRoles = ['Admin', 'Agent', 'QA', 'TL'];
    if (!enforcedRoles.includes(user.role)) {
      return res.status(200).json({
        status: true,
        message: 'Terms not required for this role',
        data: user,
      });
    }

    user.acceptedTerms = true;
    user.acceptedTermsAt = getIndiaTime();
    await user.save({ validateModifiedOnly: true });

    return res.status(200).json({ status: true, message: 'Terms accepted', data: user });
  } catch (error) {
    console.error('Accept terms error:', error);
    return res.status(500).json({ status: false, message: 'Failed to record terms acceptance' });
  }
};

//------------------< LOGOUT >------------------//
exports.logoutUser = async (req, res) => {
  try {
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({
        message: 'User not authenticated',
        status: false,
      });
    }

    const user = await User.findById(userId);

    if (!user) {
      return res.status(404).json({
        message: 'User not found',
        status: false,
      });
    }

    const logoutTime = getIndiaTime();

    // ✅ Accumulate final active time before logging out
    if ((user.workStatus === 'active' || user.workStatus === 'busy') && user.lastStatusChangeTime) {
      const finalSessionDuration = (logoutTime - new Date(user.lastStatusChangeTime)) / 1000 / 60;
      user.accumulatedActiveTime =
        (user.accumulatedActiveTime || 0) + Math.max(0, finalSessionDuration);
    }

    // If user is on break when logging out, end the break FIRST (before changing status)
    if (user.workStatus === 'break' && user.break_time) {
      const breakStart = new Date(user.break_time);
      const breakDurationInMinutes = Math.floor((logoutTime - breakStart) / 60000);

      if (breakDurationInMinutes > 0) {
        user.breakLogs = user.breakLogs || [];
        user.breakLogs.push({
          start: breakStart,
          end: logoutTime,
          duration: breakDurationInMinutes,
        });
      }
      user.break_time = null;
    }

    // IMPORTANT: Always set logout_time when user goes offline
    // This handles both explicit logout and implicit checkout/disconnect
    user.is_active = false;
    user.logout_time = logoutTime;
    user.workStatus = 'offline';

    await user.save({ validateModifiedOnly: true });

    // Save to DailyActivity (Historical Record)
    if (user.login_time && user.organizationId) {
      const loginTime = new Date(user.login_time);
      const startOfDay = new Date(loginTime);
      startOfDay.setHours(0, 0, 0, 0);

      const totalBreakMinutes = user.breakLogs.reduce((acc, log) => acc + (log.duration || 0), 0);

      // Update/Create DailyActivity
      await DailyActivity.findOneAndUpdate(
        {
          userId: user._id,
          date: startOfDay,
          organizationId: user.organizationId,
        },
        {
          $set: {
            logoutTime: logoutTime,
            totalOnlineTime: user.accumulatedActiveTime, // Only productive time
            breakLogs: user.breakLogs,
            totalBreakTime: totalBreakMinutes,
            breakCount: user.breakLogs.length,
          },
          $setOnInsert: {
            loginTime: loginTime,
          },
        },
        { upsert: true, new: true }
      );
    }

    console.log(`✅ User ${user.name} logged out at ${logoutTime}`);

    return res.status(200).json({
      message: 'Logged out successfully',
      status: true,
    });
  } catch (error) {
    console.error('Logout error:', error);
    return res.status(500).json({
      message: 'Server error during logout',
      status: false,
    });
  }
};

//------------------< BREAK >------------------//

//------------------< TOGGLE BREAK >------------------//
exports.toggleBreak = async (req, res) => {
  try {
    const userId = req.user?.id;
    const agent = await User.findById(userId);

    if (!agent) {
      return res.status(404).json({ message: 'Agent not found', status: false });
    }

    const now = getIndiaTime();

    if (agent.workStatus === 'active' || agent.workStatus === 'busy') {
      // Agent is going on break - Accumulate active time first
      if (agent.lastStatusChangeTime) {
        const activeDuration = (now - new Date(agent.lastStatusChangeTime)) / 1000 / 60;
        agent.accumulatedActiveTime =
          (agent.accumulatedActiveTime || 0) + Math.max(0, activeDuration);
      }

      agent.workStatus = 'break';
      agent.break_time = now;
      agent.lastStatusChangeTime = now; // Track when break started

      await agent.save({ validateModifiedOnly: true });
      return res.status(200).json({
        message: 'Break started',
        status: true,
        data: agent,
      });
    } else if (agent.workStatus === 'break') {
      // Break ending
      const breakStart = agent.break_time ? new Date(agent.break_time) : now;
      const breakEnd = now;

      let breakDurationInMinutes = 0;

      // ✅ Only calculate if both dates are valid
      if (!isNaN(breakStart) && !isNaN(breakEnd)) {
        const durationMs = breakEnd - breakStart;
        breakDurationInMinutes = Math.max(Math.round(durationMs / 60000), 0);
      }

      // ✅ Avoid NaN
      if (isNaN(breakDurationInMinutes)) breakDurationInMinutes = 0;

      // ✅ Save break log
      agent.breakLogs.push({
        start: breakStart,
        end: breakEnd,
        duration: breakDurationInMinutes,
      });

      // Sort logs (latest first)
      agent.breakLogs.sort((a, b) => new Date(b.start) - new Date(a.start));

      // Update status
      agent.workStatus = 'active';
      agent.break_time = null;
      agent.lastStatusChangeTime = now; // Reset timer for new active session

      await agent.save({ validateModifiedOnly: true });

      return res.status(200).json({
        message: `Break ended after ${breakDurationInMinutes} minute(s), agent is now active`,
        status: true,
        data: {
          agent,
          breakDurationInMinutes,
        },
      });
    } else {
      return res.status(400).json({ message: 'Invalid work status', status: false });
    }
  } catch (err) {
    console.error('Toggle break error:', err);
    return res.status(500).json({ message: 'Server error', status: false });
  }
};

//------------------< RESET WORK STATUS (without affecting active time) >------------------//
exports.resetWorkStatus = async (req, res) => {
  try {
    const userId = req.user?.id;
    const user = await User.findById(userId);

    if (!user) {
      return res.status(404).json({ message: 'User not found', status: false });
    }

    const now = getIndiaTime();

    // If coming from break, close the break properly
    if (user.workStatus === 'break' && user.break_time) {
      const breakStart = new Date(user.break_time);
      const breakDurationInMinutes = Math.max(0, Math.round((now - breakStart) / 60000));

      user.breakLogs = user.breakLogs || [];
      user.breakLogs.push({
        start: breakStart,
        end: now,
        duration: breakDurationInMinutes,
      });
      user.break_time = null;
    }

    // Reset to active without touching accumulated time
    user.workStatus = 'active';
    user.is_active = true;
    user.lastStatusChangeTime = now;

    await user.save({ validateModifiedOnly: true });

    console.log(`✅ Work status reset to 'active' for ${user.name} (${user.email})`);

    return res.status(200).json({
      message: 'Work status reset to active',
      status: true,
      data: {
        workStatus: user.workStatus,
        is_active: user.is_active,
        accumulatedActiveTime: user.accumulatedActiveTime,
      },
    });
  } catch (err) {
    console.error('Reset work status error:', err);
    return res.status(500).json({ message: 'Server error', status: false });
  }
};

//------------------< GET CURRENT ACTIVE TIME >------------------//
exports.getCurrentActiveTime = async (req, res) => {
  try {
    const userId = req.user?.id;
    const user = await User.findById(userId).select(
      'accumulatedActiveTime lastStatusChangeTime workStatus'
    );

    if (!user) {
      return res.status(404).json({ status: false, message: 'User not found' });
    }

    let currentActiveTime = user.accumulatedActiveTime || 0;

    console.log('DEBUG ACTIVE TIME:', {
      id: user._id,
      status: user.workStatus,
      accumulated: user.accumulatedActiveTime,
      lastChange: user.lastStatusChangeTime,
      now: new Date(),
    });

    if ((user.workStatus === 'active' || user.workStatus === 'busy') && user.lastStatusChangeTime) {
      const now = new Date();
      const currentSessionTime = (now - new Date(user.lastStatusChangeTime)) / 1000 / 60;

      console.log('DEBUG CALCULATION:', {
        now: now,
        lastChange: new Date(user.lastStatusChangeTime),
        diffMs: now - new Date(user.lastStatusChangeTime),
        sessionMin: currentSessionTime,
      });

      currentActiveTime += Math.max(0, currentSessionTime);
    }

    // ✅ Return PRECISE time (don't floor it) so frontend can show seconds
    return res.status(200).json({
      status: true,
      data: {
        activeTimeMinutes: currentActiveTime, // Return float (e.g. 0.55 mins)
        workStatus: user.workStatus,
      },
    });
  } catch (error) {
    console.error('Get active time error:', error);
    return res.status(500).json({ status: false, message: 'Failed to get active time' });
  }
};

//------------------< SEND OTP RESET PASSWORD >------------------//
//------------------< SEND OTP RESET PASSWORD >------------------//
// In-memory OTP storage for user controller (separate from forgotPassword controller)
const userOtpStore = new Map();

exports.otpResetPassword = async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) {
      return res.status(400).json({ message: 'Email is required.', status: false, data: null });
    }
    const userInfo = await User.findOne({ email });
    if (!userInfo) {
      return res.status(404).json({
        message: 'Email is not registered. Please sign up.',
        status: false,
        data: null,
      });
    }

    const newOtp = generateEmailOtp();

    // Store OTP with expiry (10 mins) and attempts
    userOtpStore.set(email, {
      otp: newOtp,
      userId: userInfo._id,
      expiresAt: Date.now() + 10 * 60 * 1000,
      attempts: 0,
    });

    // Clean up expired OTPs
    setTimeout(
      () => {
        if (userOtpStore.has(email) && userOtpStore.get(email).otp === newOtp) {
          userOtpStore.delete(email);
        }
      },
      10 * 60 * 1000
    );

    await transporter.sendMail({
      from: `"${process.env.SMTP_FROM_NAME || 'Kalinga Support'}" <${
        process.env.SMTP_FROM_EMAIL || process.env.EMAIL_USER || process.env.SMTP_USERNAME
      }>`,
      to: email,
      subject: 'OTP to reset password',
      text: `Your OTP is: ${newOtp}.`,
    });
    return res.status(200).json({
      message: 'OTP sent to your email. Please check your inbox.',
      status: true,
      data: null,
    });
  } catch (error) {
    console.error('Error sending OTP email:', error);
    return res.status(500).json({ message: 'Internal server error.', status: false, data: null });
  }
};
//------------------< CHANGE PASSWORD OTP >------------------//
exports.changePasswordByOtp = async (req, res) => {
  try {
    // NOTE: This endpoint expects 'email' to be passed to identify the user.
    // If frontend doesn't send email, this will fail.
    // We try to find the user by OTP if email is missing, but that's insecure if OTPs collide.
    // Given the previous code used a global variable, we must rely on email or assume single-user (which is wrong).
    // For now, we will require email or try to find by OTP (risky but better than global).

    const { password, confirmPassword, otp, email } = req.body;

    if (!password || !confirmPassword || !otp) {
      return res.status(400).json({
        message: 'All fields are mandatory',
        status: false,
        data: null,
      });
    }

    let targetEmail = email;
    let storedData;

    if (targetEmail) {
      storedData = userOtpStore.get(targetEmail);
    } else {
      // Fallback: Try to find by OTP (inefficient and potentially ambiguous)
      for (const [key, value] of userOtpStore.entries()) {
        if (value.otp === otp) {
          targetEmail = key;
          storedData = value;
          break;
        }
      }
    }

    if (!storedData) {
      return res.status(400).json({ message: 'Invalid or expired OTP', status: false, data: null });
    }

    if (Date.now() > storedData.expiresAt) {
      userOtpStore.delete(targetEmail);
      return res.status(400).json({ message: 'Your OTP has expired', status: false, data: null });
    }

    if (storedData.attempts >= 3) {
      userOtpStore.delete(targetEmail);
      return res.status(400).json({
        message: 'Too many failed attempts. Please request a new OTP.',
        status: false,
        data: null,
      });
    }

    if (storedData.otp !== otp) {
      storedData.attempts += 1;
      userOtpStore.set(targetEmail, storedData);
      return res.status(400).json({
        message: 'OTP does not match. Please enter the correct OTP',
        status: false,
        data: null,
      });
    }

    if (password !== confirmPassword) {
      return res.status(400).json({ message: 'Passwords do not match', status: false, data: null });
    }

    const newHashedPassword = await bcrypt.hash(password, 10);
    const update = { password: newHashedPassword };
    const updatedUser = await User.findByIdAndUpdate(storedData.userId, update, {
      new: true,
    });

    if (!updatedUser) {
      return res.status(404).json({ message: 'User not found', status: false, data: null });
    }

    // Clear OTP after success
    userOtpStore.delete(targetEmail);

    return res.status(200).json({
      message: 'Password changed successfully',
      status: true,
      data: updatedUser,
    });
  } catch (error) {
    console.error('Error changing password:', error);
    return res.status(500).json({ message: 'Internal Server Error', status: false, data: null });
  }
};

//------------------< RESET EMPLOYEE PASSWORD BY ADMIN >------------------//
exports.resetEmployeePassword = async (req, res) => {
  try {
    const { id } = req.params;
    const { password } = req.body;

    // ✅ Get organizationId from logged-in admin
    const adminOrganizationId = req.user?.organizationId;

    if (!adminOrganizationId) {
      return res.status(400).json({
        message: 'Only organization admins can reset employee passwords',
        status: false,
      });
    }

    if (!password || password.length < 6) {
      return res.status(400).json({
        message: 'Password must be at least 6 characters long',
        status: false,
      });
    }

    // First find the employee to check organization
    const employee = await User.findById(id);
    if (!employee) {
      return res.status(404).json({
        message: 'Employee not found',
        status: false,
      });
    }

    // ✅ Security: Admin can only reset passwords of employees in their organization
    if (employee.organizationId.toString() !== adminOrganizationId.toString()) {
      return res.status(403).json({
        message: 'You can only reset passwords for employees in your organization',
        status: false,
      });
    }

    // Hash the new password
    const hashedPassword = await bcrypt.hash(password, 10);
    const encryptedPass = encryptPassword(password); // Store encrypted version

    // Update both hashed and encrypted password
    employee.password = hashedPassword;
    employee.encryptedPassword = encryptedPass; // Store encrypted version for admin viewing
    employee.visiblePassword = password; // Store plain text for recovery
    await employee.save();

    return res.status(200).json({
      message: 'Password reset successfully',
      status: true,
      data: employee,
    });
  } catch (error) {
    console.error('Error resetting employee password:', error);
    return res.status(500).json({
      message: 'Failed to reset password. Please try again later.',
      status: false,
    });
  }
};

//------------------< GET ALL EMPLOYEES (Admin, Agent, QA) >------------------//
exports.getAllEmployees = async (req, res) => {
  try {
    // ✅ Get organizationId from logged-in user (Admin only)
    const organizationId = req.user?.organizationId;

    // Debug logging
    console.log('🔍 Get All Employees - User Info:', {
      userId: req.user?.id,
      role: req.user?.role,
      organizationId: organizationId,
      hasOrgId: !!organizationId,
    });

    if (!organizationId) {
      return res.status(400).json({
        message: 'Your account is not linked to an organization. Please contact SuperAdmin.',
        status: false,
      });
    }

    // ✅ Fetch only employees from the same organization (include TL)
    const employees = await User.find({
      role: { $in: ['Admin', 'Agent', 'QA', 'TL'] },
      organizationId: organizationId,
    })
      .select(
        'name email role alias department address tier profileImage visiblePassword employee_id mobile is_active workStatus isBlocked login_time logout_time break_time breakLogs accumulatedActiveTime lastStatusChangeTime'
      )
      .sort({ createdAt: -1 });

    const now = getIndiaTime();

    // Calculate real-time active time for each employee and sync status fields
    const employeesWithActiveTime = employees.map((emp) => {
      let currentActiveTime = emp.accumulatedActiveTime || 0;
      const empObj = emp.toObject();

      // ✅ SYNC: Fix inconsistent status data
      // If is_active is false, workStatus should be 'offline'
      if (!emp.is_active && emp.workStatus !== 'offline') {
        empObj.workStatus = 'offline';
      }
      // If is_active is true but workStatus is 'offline', set to 'active'
      if (emp.is_active && emp.workStatus === 'offline') {
        empObj.workStatus = 'active';
      }
      // If is_active is false, logout_time should exist (use lastStatusChangeTime if missing)
      if (!emp.is_active && !emp.logout_time && emp.lastStatusChangeTime) {
        empObj.logout_time = emp.lastStatusChangeTime;
      }

      // If currently active/busy, add the time since last status change
      if (
        (empObj.workStatus === 'active' || empObj.workStatus === 'busy') &&
        emp.lastStatusChangeTime
      ) {
        const activeDuration = (now - new Date(emp.lastStatusChangeTime)) / 1000 / 60;
        currentActiveTime += Math.max(0, activeDuration);
      }

      return {
        ...empObj,
        activeTime: currentActiveTime, // Return in minutes
      };
    });

    return res.status(200).json({
      message: 'All employees fetched successfully',
      status: true,
      data: employeesWithActiveTime,
    });
  } catch (error) {
    console.error('Error fetching employees:', error);
    return res.status(500).json({
      message: 'Failed to fetch employees. Please try again later.',
      status: false,
    });
  }
};

//------------------< EXPORT USER DATA >------------------//
exports.exportUserData = async (req, res) => {
  try {
    const users = await User.find().select('-password'); // Fetch all users without passwords
    res.status(200).json({
      message: 'User data exported successfully',
      status: true,
      data: users,
    });
  } catch (error) {
    console.error('Error exporting user data:', error);
    return res.status(500).json({ message: 'Failed to export user data', status: false });
  }
};
//------------------< UPDATE EMPLOYEE STATUS >------------------//
exports.updateEmployeeStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { is_active } = req.body;

    // ✅ Get organizationId from logged-in admin
    const adminOrganizationId = req.user?.organizationId;

    if (!adminOrganizationId) {
      return res.status(400).json({
        message: 'Only organization users can update employee status',
        status: false,
      });
    }

    // First find the employee to check organization
    const employee = await User.findById(id);
    if (!employee) {
      return res.status(404).json({
        message: 'Employee not found',
        status: false,
      });
    }

    // ✅ Verify employee belongs to the same organization
    if (employee.organizationId?.toString() !== adminOrganizationId.toString()) {
      return res.status(403).json({
        message: 'You can only update status of employees from your organization',
        status: false,
      });
    }

    // Update the employee status
    employee.is_active = is_active;
    await employee.save({ validateModifiedOnly: true });

    return res.status(200).json({
      message: 'Employee status updated successfully',
      status: true,
      data: employee,
    });
  } catch (error) {
    console.error('Error updating employee status:', error);
    return res.status(500).json({
      message: 'Failed to update employee status',
      status: false,
    });
  }
};

//------------------< UNBLOCK LOGIN ACCOUNT >------------------//
exports.unblockLoginAccount = async (req, res) => {
  try {
    const { id } = req.params;

    // ✅ Get organizationId from logged-in admin
    const adminOrganizationId = req.user?.organizationId;

    if (!adminOrganizationId) {
      return res.status(400).json({
        message: 'Only organization users can unblock accounts',
        status: false,
      });
    }

    // Find the employee
    const employee = await User.findById(id);
    if (!employee) {
      return res.status(404).json({
        message: 'Employee not found',
        status: false,
      });
    }

    // ✅ Verify employee belongs to the same organization
    if (employee.organizationId?.toString() !== adminOrganizationId.toString()) {
      return res.status(403).json({
        message: 'You can only unblock accounts from your organization',
        status: false,
      });
    }

    // Reset login block fields
    console.log('🔓 Unblocking account:', {
      userId: employee._id,
      email: employee.email,
      beforeUnblock: {
        isBlocked: employee.isBlocked,
        failedLoginAttempts: employee.failedLoginAttempts,
        failedIpAttempts: employee.failedIpAttempts,
      },
    });

    employee.isBlocked = false;
    employee.failedLoginAttempts = 0;
    employee.failedIpAttempts = 0; // Reset IP mismatch attempts
    employee.blockedAt = null;
    employee.blockedReason = null;

    // Mark fields as modified to ensure Mongoose saves them
    employee.markModified('isBlocked');
    employee.markModified('failedLoginAttempts');
    employee.markModified('failedIpAttempts');
    employee.markModified('blockedAt');
    employee.markModified('blockedReason');

    await employee.save();

    console.log('✅ Account unblocked successfully:', {
      userId: employee._id,
      afterUnblock: {
        isBlocked: employee.isBlocked,
        failedLoginAttempts: employee.failedLoginAttempts,
        failedIpAttempts: employee.failedIpAttempts,
      },
    });

    return res.status(200).json({
      message: 'Account unblocked successfully. User can now login.',
      status: true,
      data: {
        _id: employee._id,
        name: employee.name,
        email: employee.email,
        role: employee.role,
        isBlocked: employee.isBlocked,
      },
    });
  } catch (error) {
    console.error('Error unblocking account:', error);
    return res.status(500).json({
      message: 'Failed to unblock account',
      status: false,
    });
  }
};

//------------------< UPDATE USER AUTHORIZED IP >------------------//
exports.updateUserAuthorizedIP = async (req, res) => {
  try {
    const { employeeId, newIP } = req.body;

    console.log('📍 Updating authorized IP:', { employeeId, newIP });

    if (!employeeId || !newIP) {
      return res.status(400).json({
        message: 'Employee ID and new IP address are required',
        status: false,
      });
    }

    // Validate IP format (basic validation)
    const ipRegex =
      /^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/;
    if (!ipRegex.test(newIP)) {
      return res.status(400).json({
        message: 'Invalid IP address format',
        status: false,
      });
    }

    const employee = await User.findById(employeeId);

    if (!employee) {
      return res.status(404).json({
        message: 'Employee not found',
        status: false,
      });
    }

    const oldIP = employee.ip;
    employee.ip = newIP;

    // Reset IP-related blocking fields if they were blocked due to IP mismatch
    if (employee.blockedReason === 'Multiple login attempts from unauthorized IP address') {
      employee.isBlocked = false;
      employee.blockedAt = null;
      employee.blockedReason = null;
      employee.markModified('isBlocked');
      employee.markModified('blockedAt');
      employee.markModified('blockedReason');
      console.log('🔓 Also unblocking account since it was blocked due to IP mismatch');
    }

    employee.failedIpAttempts = 0;
    employee.markModified('ip');
    employee.markModified('failedIpAttempts');

    await employee.save();

    console.log('✅ Authorized IP updated successfully:', {
      employeeName: employee.name,
      oldIP: oldIP || 'None',
      newIP,
      wasBlocked:
        !!oldIP &&
        employee.blockedReason === 'Multiple login attempts from unauthorized IP address',
    });

    return res.status(200).json({
      message: `Authorized IP updated successfully from ${oldIP || 'None'} to ${newIP}`,
      status: true,
      data: {
        _id: employee._id,
        name: employee.name,
        email: employee.email,
        role: employee.role,
        ip: employee.ip,
        isBlocked: employee.isBlocked,
      },
    });
  } catch (error) {
    console.error('❌ Error updating authorized IP:', error);
    return res.status(500).json({
      message: 'Failed to update authorized IP',
      status: false,
    });
  }
};

//------------------< UPDATE EMPLOYEE BY ADMIN >------------------//
exports.updateEmployeeByAdmin = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, mobile, role, department, address, password, tier, alias, employee_id } =
      req.body;

    console.log('📝 Update Employee Request:', {
      employeeId: id,
      body: req.body,
      hasFile: !!req.file,
      fileName: req.file?.filename,
    });

    // ✅ Get organizationId from logged-in admin
    const adminOrganizationId = req.user?.organizationId;

    if (!adminOrganizationId) {
      return res.status(400).json({
        message: 'Only organization users can update employees',
        status: false,
      });
    }

    // Find the employee
    const employee = await User.findById(id);
    if (!employee) {
      return res.status(404).json({
        message: 'Employee not found',
        status: false,
      });
    }

    // ✅ Verify employee belongs to the same organization
    if (employee.organizationId?.toString() !== adminOrganizationId.toString()) {
      return res.status(403).json({
        message: 'You can only update employees from your organization',
        status: false,
      });
    }

    // ✅ Prevent changing organizationId
    if (
      req.body.organizationId &&
      req.body.organizationId !== employee.organizationId?.toString()
    ) {
      return res.status(403).json({
        message: 'Cannot change employee organization',
        status: false,
      });
    }

    // Update fields if provided
    if (name) employee.name = name;
    if (mobile) employee.mobile = mobile;
    if (role) employee.role = role;
    if (department) employee.department = department;
    if (employee_id) employee.employee_id = employee_id;

    // Tier editable only for Agent/QA/TL; if role changed away from those, clear tier
    if (tier !== undefined) {
      if (['Agent', 'QA', 'TL'].includes(employee.role)) {
        employee.tier = tier || employee.tier; // allow setting to empty to clear
      } else {
        employee.tier = null; // ensure non-escalation roles have null tier
      }
    }
    // If role was changed to a non-escalation role, ensure tier is cleared even if not provided in payload
    if (!['Agent', 'QA', 'TL'].includes(employee.role)) {
      employee.tier = null;
      employee.alias = null; // Clear alias for non-escalation roles
    }
    // Handle alias field for Agent/QA/TL roles
    if (alias !== undefined) {
      if (['Agent', 'QA', 'TL'].includes(employee.role)) {
        employee.alias = alias || employee.alias;
      } else {
        employee.alias = null; // Clear alias for non-escalation roles
      }
    }
    if (address) {
      try {
        employee.address = typeof address === 'string' ? JSON.parse(address) : address;
      } catch (error) {
        console.error('Error parsing address JSON:', error);
        // If parsing fails, we might want to ignore it or handle it.
        // For now, let's assume if it's not valid JSON, we don't update it or keep it as is if schema allows.
        // But schema is nested. Let's try to assign it anyway if it's not JSON, maybe it's a legacy string?
        // Actually, better to just log and maybe not update if invalid to avoid crashing save.
      }
    }

    // Update profile image if provided
    if (req.file) {
      try {
        // Delete old image from Cloudinary if it exists
        if (employee.cloudinaryPublicId) {
          console.log(
            '🗑️ Deleting old profile image from Cloudinary:',
            employee.cloudinaryPublicId
          );
          try {
            await deleteFromCloudinary(employee.cloudinaryPublicId);
            console.log('✅ Old profile image deleted from Cloudinary');
          } catch (deleteError) {
            console.error('Error deleting old image:', deleteError);
            // Continue even if delete fails
          }
        }

        // Upload new image to Cloudinary
        console.log('📤 Uploading profile image to Cloudinary...');
        const cloudinaryResult = await uploadToCloudinary(req.file.buffer, 'profile-images');
        employee.profileImage = cloudinaryResult.url;
        employee.cloudinaryPublicId = cloudinaryResult.publicId;
        console.log('✅ Profile image uploaded to Cloudinary:', employee.profileImage);
      } catch (cloudError) {
        console.error('Cloudinary upload error:', cloudError);
        return res.status(500).json({
          message: 'Failed to upload profile image',
          status: false,
        });
      }
    }

    // Update password if provided
    if (password && password.trim() !== '') {
      employee.password = await bcrypt.hash(password, 10);
    }

    // Save the updated employee
    const updatedEmployee = await employee.save({ validateModifiedOnly: true });

    console.log('✅ Employee updated successfully:', {
      id: updatedEmployee._id,
      name: updatedEmployee.name,
      profileImage: updatedEmployee.profileImage,
    });

    return res.status(200).json({
      message: 'Employee updated successfully',
      status: true,
      data: updatedEmployee,
    });
  } catch (error) {
    console.error('❌ Error updating employee:', error);
    return res.status(500).json({
      message: 'Failed to update employee',
      status: false,
      error: error.message,
    });
  }
};

//------------------< ESCALATION HIERARCHY (Tier -> Department -> Users) >------------------//
exports.getEscalationHierarchy = async (req, res) => {
  try {
    const organizationId = req.user?.organizationId;
    if (!organizationId) {
      return res.status(400).json({
        message: 'Your account is not linked to an organization.',
        status: false,
      });
    }

    const roles = ['Agent', 'QA', 'TL']; // recipients shown tier-wise
    const employees = await User.find({
      organizationId,
      role: { $in: roles },
    }).select('name user_name email role department tier workStatus profileImage');

    // Group by tier then department
    const tiers = ['Tier-1', 'Tier-2', 'Tier-3'];
    const depts = ['Accounts', 'Technicals', 'Billings', 'Supports'];
    const hierarchy = {};
    tiers.forEach((t) => {
      hierarchy[t] = {};
      depts.forEach((d) => {
        hierarchy[t][d] = [];
      });
    });

    for (const emp of employees) {
      const t = emp.tier || 'Tier-1';
      const d = emp.department || 'Supports';
      if (!hierarchy[t]) hierarchy[t] = {};
      if (!hierarchy[t][d]) hierarchy[t][d] = [];
      hierarchy[t][d].push({
        _id: emp._id,
        name: emp.name,
        user_name: emp.user_name,
        email: emp.email,
        role: emp.role,
        department: emp.department,
        tier: emp.tier,
        workStatus: emp.workStatus,
        profileImage: emp.profileImage,
      });
    }

    return res.status(200).json({ status: true, data: hierarchy });
  } catch (error) {
    console.error('Hierarchy fetch error:', error);
    return res.status(500).json({ status: false, message: 'Failed to fetch escalation hierarchy' });
  }
};

// Get assignable agents for ticket assignment/escalation (accessible to all authenticated users)
exports.getAssignableAgents = async (req, res) => {
  try {
    const organizationId = req.user?.organizationId;

    console.log('🔍 Get Assignable Agents - User Info:', {
      userId: req.user?.id,
      role: req.user?.role,
      organizationId: organizationId,
    });

    if (!organizationId) {
      return res.status(400).json({
        message: 'Your account is not linked to an organization.',
        status: false,
      });
    }

    // Fetch Agent, TL, QA from same organization (for escalation/assignment)
    // Exclude the current user from the list
    const agents = await User.find({
      role: { $in: ['Agent', 'QA', 'TL'] },
      organizationId: organizationId,
      _id: { $ne: req.user.id },
    })
      .select('name email role alias department tier profileImage workStatus')
      .sort({ tier: 1, department: 1, name: 1 }); // Sort by tier, then department, then name

    console.log('✅ Assignable agents found:', agents.length);

    return res.status(200).json({
      message: 'Assignable agents fetched successfully',
      status: true,
      data: agents,
    });
  } catch (error) {
    console.error('Error fetching assignable agents:', error);
    return res.status(500).json({
      status: false,
      message: 'Failed to fetch assignable agents',
    });
  }
};

// Get 30-day activity history for a user
exports.get30DayActivity = async (req, res) => {
  try {
    const { userId } = req.params;
    const requestorRole = req.user?.role;
    const requestorId = req.user?.id;
    const organizationId = req.user?.organizationId;

    // Check permissions: Admin/TL/Management can view anyone, others can only view themselves
    if (!['Admin', 'TL', 'Management'].includes(requestorRole) && requestorId !== userId) {
      return res.status(403).json({
        message: 'You do not have permission to view this data',
        status: false,
      });
    }

    if (!organizationId) {
      return res.status(400).json({
        message: 'Your account is not linked to an organization.',
        status: false,
      });
    }

    // Get last 30 days of activity
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    thirtyDaysAgo.setHours(0, 0, 0, 0);

    const activities = await DailyActivity.find({
      userId: userId,
      organizationId: organizationId,
      date: { $gte: thirtyDaysAgo },
    })
      .sort({ date: -1 })
      .limit(30);

    return res.status(200).json({
      message: '30-day activity fetched successfully',
      status: true,
      data: activities,
    });
  } catch (error) {
    console.error('Error fetching 30-day activity:', error);
    return res.status(500).json({
      status: false,
      message: 'Failed to fetch activity history',
    });
  }
};

// ==================== GET ORGANIZATION INFO ====================
/**
 * Get organization info for authenticated user
 * Returns organization name and display name
 * Works for all roles except SuperAdmin
 */
exports.getOrganizationInfo = async (req, res) => {
  try {
    const userId = req.user?._id || req.user?.id;

    if (!userId) {
      return res.status(401).json({
        status: false,
        message: 'User not authenticated',
      });
    }

    // Get user with organization details
    const user = await User.findById(userId).select('organizationId role').lean();

    if (!user) {
      return res.status(404).json({
        status: false,
        message: 'User not found',
      });
    }

    // SuperAdmin doesn't have organization
    if (user.role === 'SuperAdmin') {
      return res.status(200).json({
        status: true,
        data: {
          name: 'LIVE CHAT CRM',
          displayName: 'LIVE CHAT CRM',
        },
      });
    }

    if (!user.organizationId) {
      return res.status(404).json({
        status: false,
        message: 'Organization not found for user',
      });
    }

    // Fetch organization details
    const organization = await Organization.findById(user.organizationId)
      .select('name displayName')
      .lean();

    if (!organization) {
      return res.status(404).json({
        status: false,
        message: 'Organization not found',
      });
    }

    res.status(200).json({
      status: true,
      data: {
        name: organization.displayName || organization.name,
        displayName: organization.displayName || organization.name,
      },
    });
  } catch (error) {
    console.error('Get Organization Info Error:', error);
    res.status(500).json({
      status: false,
      message: 'Failed to fetch organization info',
      error: error.message,
    });
  }
};

// ==================== GET ACTIVITY REPORT (DAILY/WEEKLY/MONTHLY) ====================
/**
 * Get aggregated activity report for all agents in the organization
 * Query params:
 *   - period=daily|weekly|monthly (default: daily)
 *   - month=1-12 (optional, for specific month)
 *   - year=YYYY (optional, for specific year)
 * Returns historical data from DailyActivity collection
 */
exports.getActivityReport = async (req, res) => {
  try {
    const userId = req.user?._id || req.user?.id;
    const { period = 'daily', month, year } = req.query;

    if (!userId) {
      return res.status(401).json({
        status: false,
        message: 'User not authenticated',
      });
    }

    // Get user's organization
    const user = await User.findById(userId).select('organizationId role').lean();
    if (!user || !user.organizationId) {
      return res.status(400).json({
        status: false,
        message: 'User not linked to an organization',
      });
    }

    const organizationId = user.organizationId;

    // Calculate date range based on period or specific month
    const now = new Date();
    let startDate, endDate;

    if (month && year) {
      // Specific month filter
      const monthNum = parseInt(month) - 1; // JavaScript months are 0-indexed
      const yearNum = parseInt(year);
      startDate = new Date(yearNum, monthNum, 1, 0, 0, 0, 0);
      endDate = new Date(yearNum, monthNum + 1, 0, 23, 59, 59, 999); // Last day of month
    } else if (period === 'weekly') {
      startDate = new Date(now);
      startDate.setDate(startDate.getDate() - 7);
      startDate.setHours(0, 0, 0, 0);
      endDate = now;
    } else if (period === 'monthly') {
      startDate = new Date(now);
      startDate.setDate(startDate.getDate() - 30);
      startDate.setHours(0, 0, 0, 0);
      endDate = now;
    } else {
      // Daily - today only
      startDate = new Date(now);
      startDate.setHours(0, 0, 0, 0);
      endDate = now;
    }

    // Get all agents in the organization
    const agents = await User.find({
      organizationId: organizationId,
      role: 'Agent',
    })
      .select('_id name email employee_id profileImage isBlocked')
      .lean();

    // Get activity data for all agents in the period
    const activities = await DailyActivity.find({
      organizationId: organizationId,
      date: { $gte: startDate, $lte: endDate },
    }).lean();

    // Aggregate activity by user
    const activityMap = {};
    activities.forEach((activity) => {
      const agentId = activity.userId.toString();
      if (!activityMap[agentId]) {
        activityMap[agentId] = {
          totalOnlineTime: 0,
          totalBreakTime: 0,
          totalBreakCount: 0,
          daysWorked: 0,
          dailyActivities: [],
        };
      }
      activityMap[agentId].totalOnlineTime += activity.totalOnlineTime || 0;
      activityMap[agentId].totalBreakTime += activity.totalBreakTime || 0;
      activityMap[agentId].totalBreakCount += activity.breakCount || 0;
      activityMap[agentId].daysWorked += 1;
      activityMap[agentId].dailyActivities.push({
        date: activity.date,
        loginTime: activity.loginTime,
        logoutTime: activity.logoutTime,
        onlineTime: activity.totalOnlineTime,
        breakTime: activity.totalBreakTime,
        breakCount: activity.breakCount,
      });
    });

    // Combine agent info with their activity
    const report = agents.map((agent) => {
      const agentActivity = activityMap[agent._id.toString()] || {
        totalOnlineTime: 0,
        totalBreakTime: 0,
        totalBreakCount: 0,
        daysWorked: 0,
        dailyActivities: [],
      };

      return {
        _id: agent._id,
        name: agent.name,
        email: agent.email,
        employee_id: agent.employee_id,
        profileImage: agent.profileImage,
        isBlocked: agent.isBlocked,
        ...agentActivity,
        avgOnlineTime:
          agentActivity.daysWorked > 0
            ? Math.round(agentActivity.totalOnlineTime / agentActivity.daysWorked)
            : 0,
      };
    });

    return res.status(200).json({
      status: true,
      message: `${period.charAt(0).toUpperCase() + period.slice(1)} activity report fetched successfully`,
      data: {
        period,
        startDate,
        endDate: now,
        agents: report,
      },
    });
  } catch (error) {
    console.error('Error fetching activity report:', error);
    return res.status(500).json({
      status: false,
      message: 'Failed to fetch activity report',
      error: error.message,
    });
  }
};
