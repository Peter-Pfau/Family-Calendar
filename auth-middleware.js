// Authentication middleware
function requireAuth(req, res, next) {
    if (!req.session || !req.session.userId) {
        return res.status(401).json({ error: 'Authentication required' });
    }
    next();
}

// Role-based authorization middleware
function requireRole(...allowedRoles) {
    return (req, res, next) => {
        if (!req.session || !req.session.userId) {
            return res.status(401).json({ error: 'Authentication required' });
        }

        if (!allowedRoles.includes(req.session.userRole)) {
            return res.status(403).json({ error: 'Insufficient permissions' });
        }

        next();
    };
}

// Check if user belongs to the same family
function requireSameFamily(req, res, next) {
    if (!req.session || !req.session.userId) {
        return res.status(401).json({ error: 'Authentication required' });
    }
    // Family check will be done in the route handler
    next();
}

module.exports = {
    requireAuth,
    requireRole,
    requireSameFamily
};
