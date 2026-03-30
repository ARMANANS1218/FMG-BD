/**
 * FEATURE-BASED ACCESS CONTROL (FBAC) MIDDLEWARE
 * 
 * Checks if organization has access to specific features
 * based on their subscription plan and feature flags
 */

const Organization = require('../models/Organization');

/**
 * Check if organization has a specific feature enabled
 * @param {string} featureName - Name of the feature (chat, email, query, videoCalls, etc.)
 */
const checkFeatureAccess = (featureName) => {
  return async (req, res, next) => {
    try {
      const { organizationId } = req;
      
      if (!organizationId) {
        return res.status(403).json({
          status: false,
          message: 'Organization not identified'
        });
      }
      
      // Fetch organization
      const organization = await Organization.findById(organizationId);
      
      if (!organization) {
        return res.status(404).json({
          status: false,
          message: 'Organization not found'
        });
      }
      
      // Check if organization is active
      if (!organization.isActive) {
        return res.status(403).json({
          status: false,
          message: 'Organization is inactive',
          code: 'ORG_INACTIVE'
        });
      }
      
      // Check if organization is suspended
      if (organization.isSuspended) {
        return res.status(403).json({
          status: false,
          message: 'Organization is suspended',
          reason: organization.suspensionReason,
          code: 'ORG_SUSPENDED'
        });
      }
      
      // Check if subscription is active
      if (organization.subscription.status !== 'active') {
        return res.status(403).json({
          status: false,
          message: `Subscription is ${organization.subscription.status}`,
          code: 'SUBSCRIPTION_INACTIVE'
        });
      }
      
      // Check if trial expired
      if (organization.isTrialExpired) {
        return res.status(403).json({
          status: false,
          message: 'Trial period has expired',
          code: 'TRIAL_EXPIRED'
        });
      }
      
      // Check if feature is enabled
      const feature = organization.features[featureName];
      
      if (!feature || !feature.enabled) {
        return res.status(403).json({
          status: false,
          message: `Feature '${featureName}' is not enabled for your organization`,
          code: 'FEATURE_DISABLED',
          feature: featureName
        });
      }
      
      // Check usage limits
      const canUse = organization.canUseFeature(featureName);
      
      if (!canUse.allowed) {
        return res.status(429).json({
          status: false,
          message: canUse.reason,
          code: 'LIMIT_REACHED',
          feature: featureName
        });
      }
      
      // Attach organization to request for later use
      req.organization = organization;
      req.feature = feature;
      
      next();
    } catch (error) {
      console.error('Feature Access Check Error:', error);
      res.status(500).json({
        status: false,
        message: 'Error checking feature access',
        error: error.message
      });
    }
  };
};

/**
 * Check multiple features (at least one must be enabled)
 * @param {Array} featureNames - Array of feature names
 */
const checkAnyFeature = (featureNames = []) => {
  return async (req, res, next) => {
    try {
      const { organizationId } = req;
      
      if (!organizationId) {
        return res.status(403).json({
          status: false,
          message: 'Organization not identified'
        });
      }
      
      const organization = await Organization.findById(organizationId);
      
      if (!organization || !organization.isActive || organization.isSuspended) {
        return res.status(403).json({
          status: false,
          message: 'Organization access denied'
        });
      }
      
      // Check if at least one feature is enabled
      const hasAccess = featureNames.some(featureName => {
        const feature = organization.features[featureName];
        return feature && feature.enabled === true;
      });
      
      if (!hasAccess) {
        return res.status(403).json({
          status: false,
          message: `None of the required features are enabled`,
          code: 'NO_FEATURE_ACCESS',
          requiredFeatures: featureNames
        });
      }
      
      req.organization = organization;
      next();
    } catch (error) {
      console.error('Feature Access Check Error:', error);
      res.status(500).json({
        status: false,
        message: 'Error checking feature access'
      });
    }
  };
};

/**
 * Check all features (all must be enabled)
 * @param {Array} featureNames - Array of feature names
 */
const checkAllFeatures = (featureNames = []) => {
  return async (req, res, next) => {
    try {
      const { organizationId } = req;
      
      if (!organizationId) {
        return res.status(403).json({
          status: false,
          message: 'Organization not identified'
        });
      }
      
      const organization = await Organization.findById(organizationId);
      
      if (!organization || !organization.isActive || organization.isSuspended) {
        return res.status(403).json({
          status: false,
          message: 'Organization access denied'
        });
      }
      
      // Check if all features are enabled
      const missingFeatures = featureNames.filter(featureName => {
        const feature = organization.features[featureName];
        return !feature || !feature.enabled;
      });
      
      if (missingFeatures.length > 0) {
        return res.status(403).json({
          status: false,
          message: `Required features are not enabled`,
          code: 'MISSING_FEATURES',
          missingFeatures
        });
      }
      
      req.organization = organization;
      next();
    } catch (error) {
      console.error('Feature Access Check Error:', error);
      res.status(500).json({
        status: false,
        message: 'Error checking feature access'
      });
    }
  };
};

/**
 * Increment feature usage counter
 * @param {string} featureName - Feature to increment
 */
const trackFeatureUsage = (featureName) => {
  return async (req, res, next) => {
    try {
      // This runs after the route handler
      res.on('finish', async () => {
        // Only track on successful responses
        if (res.statusCode >= 200 && res.statusCode < 300) {
          const organization = req.organization;
          if (organization) {
            await organization.incrementUsage(featureName);
          }
        }
      });
      next();
    } catch (error) {
      // Don't block request if tracking fails
      console.error('Usage tracking error:', error);
      next();
    }
  };
};

module.exports = {
  checkFeatureAccess,
  checkAnyFeature,
  checkAllFeatures,
  trackFeatureUsage
};
