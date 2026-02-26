const Query = require('../models/Query');
const User = require('../models/User');
const QueryEvaluation = require('../models/QueryEvaluation');
const moment = require('moment-timezone');
const mongoose = require('mongoose');

/**
 * 1. Daily Operations Report
 * Metrics: Chats Handled, AHT, FRT, SLA%, Abandon Rate, Refund Value
 */
exports.getDailyOperationsReport = async (req, res) => {
    try {
        const { date, organizationId } = req.query;
        const startOfDay = moment(date).startOf('day').toDate();
        const endOfDay = moment(date).endOf('day').toDate();

        const queries = await Query.find({
            organizationId,
            createdAt: { $gte: startOfDay, $lte: endOfDay }
        });

        const totalChats = queries.length;
        const closedChats = queries.filter(q => q.status === 'Closed' || q.status === 'Resolved').length;

        // SLA Calculations (FRT, AHT)
        let totalFRT = 0;
        let totalAHT = 0;
        let slaBreaches = 0;

        queries.forEach(q => {
            if (q.interactionMetrics?.firstResponseTime) {
                totalFRT += q.interactionMetrics.firstResponseTime;
                if (q.interactionMetrics.firstResponseTime > 60) slaBreaches++; // Breach if > 60s
            }
            if (q.interactionMetrics?.chatDuration) {
                totalAHT += q.interactionMetrics.chatDuration;
            }
        });

        const avgFRT = totalChats > 0 ? (totalFRT / totalChats).toFixed(2) : 0;
        const avgAHT = closedChats > 0 ? (totalAHT / closedChats / 60).toFixed(2) : 0; // In minutes
        const slaPercentage = totalChats > 0 ? (((totalChats - slaBreaches) / totalChats) * 100).toFixed(2) : 100;

        const totalRefund = queries.reduce((sum, q) => sum + (q.refundAmount || 0), 0);

        res.status(200).json({
            status: true,
            data: {
                totalChats,
                closedChats,
                openChats: totalChats - closedChats,
                avgFRT: `${avgFRT}s`,
                avgAHT: `${avgAHT}m`,
                slaPercentage: `${slaPercentage}%`,
                totalRefund: `£${totalRefund.toFixed(2)}`,
                abandonRate: '0%' // Logic for abandoned chats would go here if tracked
            }
        });
    } catch (error) {
        res.status(500).json({ status: false, message: error.message });
    }
};

/**
 * 2. Weekly Quality Report
 * Metrics: QA Score Average, CSAT%, Compliance Error%
 */
exports.getWeeklyQualityReport = async (req, res) => {
    try {
        const { startDate, endDate, organizationId } = req.query;

        const evaluations = await QueryEvaluation.find({
            organizationId,
            createdAt: { $gte: new Date(startDate), $lte: new Date(endDate) }
        });

        const totalEvals = evaluations.length;
        const avgQaScore = totalEvals > 0
            ? (evaluations.reduce((sum, e) => sum + e.totalWeightedScore, 0) / totalEvals).toFixed(2)
            : 0;

        const csatScores = evaluations.filter(e => e.csat !== undefined).map(e => e.csat);
        const avgCsat = csatScores.length > 0
            ? (csatScores.reduce((sum, s) => sum + s, 0) / csatScores.length).toFixed(2)
            : 0;

        res.status(200).json({
            status: true,
            data: {
                totalEvaluations: totalEvals,
                averageQaScore: `${avgQaScore}%`,
                averageCsat: `${avgCsat}%`,
                passed: evaluations.filter(e => e.result === 'Pass').length,
                failed: evaluations.filter(e => e.result === 'Fail').length
            }
        });
    } catch (error) {
        res.status(500).json({ status: false, message: error.message });
    }
};

/**
 * 3. Refund & Compensation Report
 */
exports.getRefundReport = async (req, res) => {
    try {
        const { startDate, endDate, organizationId } = req.query;

        const queries = await Query.find({
            organizationId,
            refundAmount: { $gt: 0 },
            createdAt: { $gte: new Date(startDate), $lte: new Date(endDate) }
        });

        res.status(200).json({
            status: true,
            data: {
                totalRefundItems: queries.length,
                totalRefundValue: `£${queries.reduce((sum, q) => sum + q.refundAmount, 0).toFixed(2)}`,
                queries: queries.map(q => ({
                    petitionId: q.petitionId,
                    refundAmount: q.refundAmount,
                    customerName: q.customerName,
                    status: q.status
                }))
            }
        });
    } catch (error) {
        res.status(500).json({ status: false, message: error.message });
    }
};

/**
 * 4. Batch Issue Trend Report
 */
exports.getBatchTrendReport = async (req, res) => {
    try {
        const { organizationId } = req.query;

        const trends = await Query.aggregate([
            { $match: { organizationId: new mongoose.Types.ObjectId(organizationId), "productInfo.batchLotNumber": { $ne: null } } },
            {
                $group: {
                    _id: "$productInfo.batchLotNumber",
                    count: { $sum: 1 },
                    productName: { $first: "$productInfo.productName" }
                }
            },
            { $sort: { count: -1 } },
            { $limit: 10 }
        ]);

        res.status(200).json({ status: true, data: trends });
    } catch (error) {
        res.status(500).json({ status: false, message: error.message });
    }
};

/**
 * 5. Monthly Performance Review (MPR)
 */
exports.getMonthlyPerformanceReview = async (req, res) => {
    try {
        const { month, year, organizationId } = req.query;
        const startOfMonth = moment([year, month - 1]).startOf('month').toDate();
        const endOfMonth = moment([year, month - 1]).endOf('month').toDate();

        const stats = await Query.aggregate([
            { $match: { organizationId: new mongoose.Types.ObjectId(organizationId), createdAt: { $gte: startOfMonth, $lte: endOfMonth } } },
            {
                $group: {
                    _id: null,
                    totalChats: { $sum: 1 },
                    resolved: { $sum: { $cond: [{ $in: ["$status", ["Resolved", "Closed"]] }, 1, 0] } },
                    avgFrt: { $avg: "$interactionMetrics.firstResponseTime" },
                    totalRefundValue: { $sum: "$refundAmount" }
                }
            }
        ]);

        res.status(200).json({ status: true, data: stats[0] || {} });
    } catch (error) {
        res.status(500).json({ status: false, message: error.message });
    }
};

/**
 * 6. Regulatory Compliance Report (GDPR & FSA)
 */
exports.getRegulatoryComplianceReport = async (req, res) => {
    try {
        const { organizationId } = req.query;

        const fsaReportable = await Query.find({
            organizationId,
            regulatoryRiskFlag: true
        }).countDocuments();

        const gdprRequests = await Query.find({
            organizationId,
            $or: [
                { "compliance.dataDeletionRequest": true },
                { "compliance.subjectAccessRequest": true }
            ]
        }).countDocuments();

        res.status(200).json({
            status: true,
            data: {
                fsaReportableCases: fsaReportable,
                gdprRequestsPending: gdprRequests,
                complianceErrors: 0 // Placeholder for specific QA audit check
            }
        });
    } catch (error) {
        res.status(500).json({ status: false, message: error.message });
    }
};

/**
 * 7. Workforce Productivity Report
 */
exports.getWorkforceProductivityReport = async (req, res) => {
    try {
        const { organizationId, startDate, endDate } = req.query;

        const productivity = await Query.aggregate([
            { $match: { organizationId: new mongoose.Types.ObjectId(organizationId), createdAt: { $gte: new Date(startDate), $lte: new Date(endDate) } } },
            {
                $group: {
                    _id: "$assignedTo",
                    agentName: { $first: "$assignedToName" },
                    chatsHandled: { $sum: 1 },
                    avgResponseTime: { $avg: "$interactionMetrics.firstResponseTime" },
                    resolvedCount: { $sum: { $cond: [{ $in: ["$status", ["Resolved", "Closed"]] }, 1, 0] } }
                }
            },
            { $sort: { chatsHandled: -1 } }
        ]);

        res.status(200).json({ status: true, data: productivity });
    } catch (error) {
        res.status(500).json({ status: false, message: error.message });
    }
};

/**
 * 8. Root Cause Analysis Report
 */
exports.getRootCauseReport = async (req, res) => {
    try {
        const { organizationId } = req.query;

        const rootCauses = await Query.aggregate([
            { $match: { organizationId: new mongoose.Types.ObjectId(organizationId), category: { $ne: null } } },
            {
                $group: {
                    _id: "$category",
                    count: { $sum: 1 },
                    avgScore: { $avg: "$qualityMetrics.csatScore" }
                }
            },
            { $sort: { count: -1 } }
        ]);

        res.status(200).json({ status: true, data: rootCauses });
    } catch (error) {
        res.status(500).json({ status: false, message: error.message });
    }
};
