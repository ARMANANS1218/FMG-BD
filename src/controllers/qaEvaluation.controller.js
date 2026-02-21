const Query = require('../models/Query');
const User = require('../models/User');
const QueryEvaluation = require('../models/QueryEvaluation');
const XLSX = require('xlsx');

// Role guards
function ensureQAOnly(req, res) {
  if (req.user?.role !== 'QA') {
    res.status(403).json({ status: false, message: 'Access denied: QA only' });
    return false;
  }
  return true;
}

function ensureQAOrTL(req, res) {
  const allowed = ['QA', 'TL'];
  if (!allowed.includes(req.user?.role)) {
    res.status(403).json({ status: false, message: 'Access denied: QA or TL only' });
    return false;
  }
  return true;
}

// Create evaluation
exports.createEvaluation = async (req, res) => {
  // QA and TL can submit weightage (evaluation)
  if (!ensureQAOrTL(req, res)) return;
  try {
    const { petitionId, scores, remarks, coachingArea, csat } = req.body;
    if (!petitionId) return res.status(400).json({ status: false, message: 'petitionId required' });
    const query = await Query.findOne({ petitionId }).populate('assignedTo');
    if (!query) return res.status(404).json({ status: false, message: 'Query not found' });
    if (!query.assignedTo) return res.status(400).json({ status: false, message: 'Query has no assigned agent' });

    // Check if evaluation already exists - allow update if it does
    const existing = await QueryEvaluation.findOne({ petitionId, evaluatedBy: req.user.id });
    if (existing) {
      // Update existing evaluation instead of creating new
      Object.assign(existing, {
        remarks: remarks || '',
        coachingArea: coachingArea || '',
        ...Object.entries(scores || {}).reduce((acc, [k, v]) => { acc[k] = { score: Number(v) || 0 }; return acc; }, {})
      });
      await existing.save();
      return res.status(200).json({ status: true, message: 'Evaluation updated', data: existing });
    }

    const evaluation = new QueryEvaluation({
      queryId: query._id,
      petitionId,
      agentId: query.assignedTo._id,
      agentName: query.assignedTo.name,
      evaluatedBy: req.user.id,
      evaluatorRole: req.user.role,
      organizationId: query.organizationId || query.assignedTo.organizationId,
      remarks: remarks || '',
      coachingArea: coachingArea || '',
      // csat removed from calculation and storage per updated policy
      // Map incoming scores { metric: number }
      ...Object.entries(scores || {}).reduce((acc, [k, v]) => { acc[k] = { score: Number(v) || 0 }; return acc; }, {})
    });

    await evaluation.save();
    res.status(201).json({ status: true, message: 'Evaluation stored', data: evaluation });
  } catch (err) {
    console.error('createEvaluation error:', err);
    res.status(500).json({ status: false, message: 'Failed to store evaluation' });
  }
};

// Get evaluation by petitionId
exports.getByPetition = async (req, res) => {
  try {
    const { petitionId } = req.params;
    const evalDoc = await QueryEvaluation.findOne({ petitionId }).populate('evaluatedBy', 'name email');
    if (!evalDoc) return res.status(404).json({ status: false, message: 'Not rated yet', data: null });
    res.json({ status: true, data: evalDoc });
  } catch (err) {
    console.error('getByPetition error:', err);
    res.status(500).json({ status: false, message: 'Failed to fetch evaluation' });
  }
};

// List evaluations (filter by agent optional)
exports.listEvaluations = async (req, res) => {
  // Allow QA and TL to view
  if (!ensureQAOrTL(req, res)) return;
  try {
    const { agentId, from, to } = req.query;
    const filter = agentId ? { agentId } : {};
    if (from || to) {
      filter.createdAt = {};
      if (from) filter.createdAt.$gte = new Date(from);
      if (to) filter.createdAt.$lte = new Date(to);
    }
    const items = await QueryEvaluation.find(filter).populate('evaluatedBy', 'name email').sort({ createdAt: -1 });
    res.json({ status: true, data: items });
  } catch (err) {
    console.error('listEvaluations error:', err);
    res.status(500).json({ status: false, message: 'Failed to list evaluations' });
  }
};

// Aggregate per agent
exports.listAgentAggregates = async (req, res) => {
  // Allow QA and TL to view aggregates
  if (!ensureQAOrTL(req, res)) return;
  try {
    const { from, to, evaluatorRole } = req.query;
    console.log('listAgentAggregates filters:', { from, to, evaluatorRole });
    const match = {};
    if (from || to) {
      match.createdAt = {};
      if (from) match.createdAt.$gte = new Date(from);
      if (to) match.createdAt.$lte = new Date(to);
    }
    if (evaluatorRole && evaluatorRole !== '') {
      match.evaluatorRole = evaluatorRole;
    }
    console.log('Match pipeline:', JSON.stringify(match));
    const pipeline = [
      Object.keys(match).length ? { $match: match } : null,
      { $group: { _id: '$agentId', count: { $sum: 1 }, avgScore: { $avg: '$totalWeightedScore' }, passCount: { $sum: { $cond: [{ $eq: ['$result', 'Pass'] }, 1, 0] } } } },
      { $lookup: { from: 'users', localField: '_id', foreignField: '_id', as: 'agent' } },
      { $unwind: '$agent' },
      { $project: { agentName: '$agent.name', count: 1, avgScore: { $round: ['$avgScore', 2] }, passRate: { $cond: [{ $eq: ['$count', 0] }, 0, { $round: [{ $multiply: [{ $divide: ['$passCount', '$count'] }, 100] }, 2] }] } } },
      { $sort: { avgScore: -1 } }
    ].filter(Boolean);
    const data = await QueryEvaluation.aggregate(pipeline);
    console.log('Aggregation result count:', data.length);
    res.json({ status: true, data });
  } catch (err) {
    console.error('listAgentAggregates error:', err);
    res.status(500).json({ status: false, message: 'Failed to aggregate evaluations' });
  }
};

// Export CSV (all or by agentId)
exports.exportCSV = async (req, res) => {
  // Allow QA and TL to export
  if (!ensureQAOrTL(req, res)) return;
  try {
    const { agentId, from, to } = req.query;
    const filter = agentId ? { agentId } : {};
    if (from || to) {
      filter.createdAt = {};
      if (from) filter.createdAt.$gte = new Date(from);
      if (to) filter.createdAt.$lte = new Date(to);
    }
    const items = await QueryEvaluation.find(filter).populate('evaluatedBy', 'name email').sort({ createdAt: -1 });
    const headers = [
      'petitionId','agentName','evaluatedBy','evaluatorRole','totalWeightedScore (%)','performanceCategory','result','createdAt','remarks','coachingArea'
    ];
    const metricKeys = [ 'greeting','probing','accuracy','resolution','processAdherence','compliance','closure','grammar','tone','personalization','flow','toolEfficiency','escalation','documentation' ];
    const allHeaders = headers.concat(metricKeys.map(k => k + '_score (%)'));
    const rows = [allHeaders.join(',')];
    items.forEach(ev => {
      const base = [
        ev.petitionId,
        JSON.stringify(ev.agentName || ''),
        JSON.stringify(ev.evaluatedBy?.name || 'N/A'),
        ev.evaluatorRole,
        ev.totalWeightedScore,
        ev.performanceCategory || 'N/A',
        ev.result,
        ev.createdAt.toISOString(),
        JSON.stringify(ev.remarks || ''),
        JSON.stringify(ev.coachingArea || '')
      ];
      const metrics = metricKeys.map(k => (ev[k]?.score ?? 0));
      rows.push(base.concat(metrics).join(','));
    });
    const csv = rows.join('\n');
    res.header('Content-Type', 'text/csv');
    res.attachment('query_evaluations.csv');
    res.send(csv);
  } catch (err) {
    console.error('exportCSV error:', err);
    res.status(500).json({ status: false, message: 'Failed to export CSV' });
  }
};

// Export XLSX (all or by agentId)
exports.exportXLSX = async (req, res) => {
  // Allow QA and TL to export
  if (!ensureQAOrTL(req, res)) return;
  try {
    const { agentId, from, to } = req.query;
    const filter = agentId ? { agentId } : {};
    if (from || to) {
      filter.createdAt = {};
      if (from) filter.createdAt.$gte = new Date(from);
      if (to) filter.createdAt.$lte = new Date(to);
    }
    const items = await QueryEvaluation.find(filter).populate('evaluatedBy', 'name email').sort({ createdAt: -1 });
    const metricKeys = [ 'greeting','probing','accuracy','resolution','processAdherence','compliance','closure','grammar','tone','personalization','flow','toolEfficiency','escalation','documentation' ];

    // Map documents to flat JSON rows
    const rows = items.map(ev => {
      const row = {
        petitionId: ev.petitionId,
        agentName: ev.agentName || '',
        evaluatedBy: ev.evaluatedBy?.name || 'N/A',
        evaluatorRole: ev.evaluatorRole,
        'totalWeightedScore (%)': ev.totalWeightedScore,
        performanceCategory: ev.performanceCategory || 'N/A',
        result: ev.result,
        createdAt: ev.createdAt ? new Date(ev.createdAt).toISOString() : '',
        remarks: ev.remarks || '',
        coachingArea: ev.coachingArea || ''
      };
      metricKeys.forEach(k => { row[`${k}_score (%)`] = ev[k]?.score ?? 0; });
      return row;
    });

    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Evaluations');
    const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'buffer' });

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="query_evaluations.xlsx"');
    res.send(buf);
  } catch (err) {
    console.error('exportXLSX error:', err);
    res.status(500).json({ status: false, message: 'Failed to export XLSX' });
  }
};