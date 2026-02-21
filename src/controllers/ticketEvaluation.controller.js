const Ticket = require('../models/Ticket'); // Legacy chat tickets
const EmailTicket = require('../email-ticketing/models/Ticket'); // Email tickets (EML-...)
const User = require('../models/User');
const TicketEvaluation = require('../models/TicketEvaluation');
const XLSX = require('xlsx');

function ensureQAOrTL(req, res) {
  const allowed = ['QA', 'TL'];
  if (!allowed.includes(req.user?.role)) {
    res.status(403).json({ status: false, message: 'Access denied: QA or TL only' });
    return false;
  }
  return true;
}

async function resolveTicket(ticketId) {
  // Email tickets use alphanumeric IDs like EML-20260104-0005
  const emailTicket = await EmailTicket.findOne({ ticketId }).populate('assignedTo');
  if (emailTicket) return { doc: emailTicket, type: 'email' };

  // Legacy chat tickets
  const chatTicket = await Ticket.findOne({ ticketId }).populate('agentId');
  if (chatTicket) return { doc: chatTicket, type: 'chat' };

  const isObjectId = require('mongoose').Types.ObjectId.isValid(ticketId);
  if (!isObjectId) return null;

  // Fallback by ObjectId for either collection
  const emailById = await EmailTicket.findById(ticketId).populate('assignedTo');
  if (emailById) return { doc: emailById, type: 'email' };

  const chatById = await Ticket.findById(ticketId).populate('agentId');
  if (chatById) return { doc: chatById, type: 'chat' };

  return null;
}

exports.evaluateTicket = async (req, res) => {
  if (!ensureQAOrTL(req, res)) return;
  try {
    const { ticketId, scores = {}, remarks = '', coachingArea = '', criticalErrors = {} } = req.body;
    if (!ticketId) return res.status(400).json({ status: false, message: 'ticketId required' });

    const resolved = await resolveTicket(ticketId);
    if (!resolved) return res.status(404).json({ status: false, message: 'Ticket not found' });

    const ticket = resolved.doc;
    const agentId = resolved.type === 'email'
      ? ticket.assignedTo || null
      : (Array.isArray(ticket.agentId) && ticket.agentId.length > 0 ? ticket.agentId[0] : ticket.agentId || null);
    const agent = agentId ? await User.findById(agentId) : null;

    // Upsert per evaluator per ticket
    const existing = await TicketEvaluation.findOne({ ticketRef: ticket._id, evaluatedBy: req.user.id });
    const payload = {
      ticketRef: ticket._id,
      ticketId: ticket.ticketId || ticket._id.toString(),
      agentId,
      agentName: agent?.name,
      organizationId: ticket.organization || ticket.organizationId,
      evaluatedBy: req.user.id,
      evaluatorRole: req.user.role,
      remarks,
      coachingArea,
      criticalErrors,
      ...scores
    };

    if (existing) {
      Object.assign(existing, payload);
      await existing.save();
      return res.json({ status: true, message: 'Evaluation updated', data: existing });
    }

    const evaluation = new TicketEvaluation(payload);
    await evaluation.save();
    return res.status(201).json({ status: true, message: 'Evaluation stored', data: evaluation });
  } catch (err) {
    console.error('evaluateTicket error:', err);
    return res.status(500).json({ status: false, message: 'Failed to store ticket evaluation' });
  }
};

exports.getByTicket = async (req, res) => {
  try {
    const { ticketId } = req.params;
    const ticket = await resolveTicket(ticketId);
    if (!ticket) return res.status(404).json({ status: false, message: 'Ticket not found' });
    const evaluation = await TicketEvaluation.findOne({
      $or: [
        { ticketRef: ticket._id },
        { ticketId }
      ]
    }).populate('evaluatedBy', 'name email role');

    if (!evaluation) return res.status(404).json({ status: false, message: 'Not rated yet', data: null });
    return res.json({ status: true, data: evaluation });
  } catch (err) {
    console.error('getByTicket error:', err);
    return res.status(500).json({ status: false, message: 'Failed to fetch ticket evaluation' });
  }
};

exports.listEvaluations = async (req, res) => {
  if (!ensureQAOrTL(req, res)) return;
  try {
    const { agentId, from, to } = req.query;
    const filter = {};
    if (agentId) filter.agentId = agentId;
    if (from || to) {
      filter.createdAt = {};
      if (from) filter.createdAt.$gte = new Date(from);
      if (to) filter.createdAt.$lte = new Date(to);
    }
    const items = await TicketEvaluation.find(filter).populate('evaluatedBy', 'name email role').sort({ createdAt: -1 });
    return res.json({ status: true, data: items });
  } catch (err) {
    console.error('listEvaluations error:', err);
    return res.status(500).json({ status: false, message: 'Failed to list ticket evaluations' });
  }
};

exports.listAggregates = async (req, res) => {
  if (!ensureQAOrTL(req, res)) return;
  try {
    const { from, to } = req.query;
    const match = {};
    if (from || to) {
      match.createdAt = {};
      if (from) match.createdAt.$gte = new Date(from);
      if (to) match.createdAt.$lte = new Date(to);
    }

    const pipeline = [
      Object.keys(match).length ? { $match: match } : null,
      {
        $group: {
          _id: '$agentId',
          count: { $sum: 1 },
          avgScore: { $avg: '$totalScore' }
        }
      },
      { $lookup: { from: 'users', localField: '_id', foreignField: '_id', as: 'agent' } },
      { $unwind: { path: '$agent', preserveNullAndEmptyArrays: true } },
      {
        $project: {
          agentName: '$agent.name',
          count: 1,
          avgScore: { $round: ['$avgScore', 2] }
        }
      },
      { $sort: { avgScore: -1 } }
    ].filter(Boolean);

    const data = await TicketEvaluation.aggregate(pipeline);
    return res.json({ status: true, data });
  } catch (err) {
    console.error('listAggregates error:', err);
    return res.status(500).json({ status: false, message: 'Failed to aggregate ticket evaluations' });
  }
};

exports.exportCSV = async (req, res) => {
  if (!ensureQAOrTL(req, res)) return;
  try {
    const { agentId, from, to } = req.query;
    const filter = {};
    if (agentId) filter.agentId = agentId;
    if (from || to) {
      filter.createdAt = {};
      if (from) filter.createdAt.$gte = new Date(from);
      if (to) filter.createdAt.$lte = new Date(to);
    }

    const items = await TicketEvaluation.find(filter).populate('evaluatedBy', 'name email').sort({ createdAt: -1 });
    const metricKeys = Object.keys(TicketEvaluation.schema.paths)
      .filter((k) => !['ticketRef','ticketId','agentId','agentName','organizationId','evaluatedBy','evaluatorRole','remarks','coachingArea','criticalErrors','hasCriticalError','totalScore','performanceCategory','createdAt','updatedAt','__v','_id'].includes(k));

    const headers = ['ticketId','agentName','evaluatedBy','evaluatorRole','totalScore','performanceCategory','hasCriticalError','createdAt','remarks','coachingArea'];
    const rows = [headers.concat(metricKeys.map(k => `${k}_score`)).join(',')];

    items.forEach(item => {
      const base = [
        item.ticketId,
        JSON.stringify(item.agentName || ''),
        JSON.stringify(item.evaluatedBy?.name || 'N/A'),
        item.evaluatorRole,
        item.totalScore,
        item.performanceCategory,
        item.hasCriticalError,
        item.createdAt?.toISOString() || '',
        JSON.stringify(item.remarks || ''),
        JSON.stringify(item.coachingArea || '')
      ];
      const metrics = metricKeys.map(k => item[k] ?? '');
      rows.push(base.concat(metrics).join(','));
    });

    const csv = rows.join('\n');
    res.header('Content-Type', 'text/csv');
    res.attachment('ticket_evaluations.csv');
    res.send(csv);
  } catch (err) {
    console.error('exportCSV error:', err);
    res.status(500).json({ status: false, message: 'Failed to export CSV' });
  }
};

exports.exportXLSX = async (req, res) => {
  if (!ensureQAOrTL(req, res)) return;
  try {
    const { agentId, from, to } = req.query;
    const filter = {};
    if (agentId) filter.agentId = agentId;
    if (from || to) {
      filter.createdAt = {};
      if (from) filter.createdAt.$gte = new Date(from);
      if (to) filter.createdAt.$lte = new Date(to);
    }

    const items = await TicketEvaluation.find(filter).populate('evaluatedBy', 'name email').sort({ createdAt: -1 });
    const metricKeys = Object.keys(TicketEvaluation.schema.paths)
      .filter((k) => !['ticketRef','ticketId','agentId','agentName','organizationId','evaluatedBy','evaluatorRole','remarks','coachingArea','criticalErrors','hasCriticalError','totalScore','performanceCategory','createdAt','updatedAt','__v','_id'].includes(k));

    const rows = items.map(item => {
      const row = {
        ticketId: item.ticketId,
        agentName: item.agentName || '',
        evaluatedBy: item.evaluatedBy?.name || 'N/A',
        evaluatorRole: item.evaluatorRole,
        totalScore: item.totalScore,
        hasCriticalError: item.hasCriticalError,
        createdAt: item.createdAt ? item.createdAt.toISOString() : '',
        remarks: item.remarks || '',
        coachingArea: item.coachingArea || '',
      };
      metricKeys.forEach((k) => { row[`${k}_score`] = item[k] ?? ''; });
      return row;
    });

    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Ticket Evaluations');
    const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'buffer' });

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="ticket_evaluations.xlsx"');
    res.send(buf);
  } catch (err) {
    console.error('exportXLSX error:', err);
    res.status(500).json({ status: false, message: 'Failed to export XLSX' });
  }
};
