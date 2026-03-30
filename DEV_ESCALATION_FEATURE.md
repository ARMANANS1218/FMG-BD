# Dev Escalation Feature - Comprehensive Documentation

## Overview
When a ticket is escalated to the Dev team (Tier-3) by Tier-2 employees (QA/TL), the chat becomes **strictly restricted** and only accessible to Tier-3 agents and Admins. This ensures sensitive development discussions remain confidential and prevents lower-tier agents from seeing technical implementation details.

---

## Feature Description

### What Happens After Escalation to Dev?

When a **Tier-2 employee** (QA or TL) escalates a ticket to a **Tier-3 Dev agent**, the following restrictions are automatically applied:

#### 1. **Customer View (Widget/Public)**
- ❌ **Chat history is completely hidden**
- ✅ **Only displays**: "Escalated to dev and query will be resolved in 24 to 48 hours."
- 📅 Shows the escalation timestamp
- 🔒 No access to previous messages or new replies

#### 2. **Tier-1 Agents (Support Agents)**
- ❌ **Cannot see the ticket** in their ticket list
- ❌ **Cannot view ticket details** or chat messages
- ❌ **Cannot reply** to the ticket
- ❌ **Cannot re-assign** the ticket
- ✅ **See blocked message**: "This ticket has been escalated to Dev team. Only Tier-3 agents can access the full details."

#### 3. **Tier-2 Employees (QA/TL)**
- ❌ **Cannot see the ticket** in their ticket list (after escalation)
- ❌ **Cannot view ticket details** or chat messages
- ❌ **Cannot reply** to the ticket
- ❌ **Cannot re-assign** the ticket
- ✅ **See blocked message**: "This ticket has been escalated to Dev team. Only Tier-3 agents can access the full details."

#### 4. **Tier-3 Agents (Dev Team)**
- ✅ **Full access** to ticket details
- ✅ **Can view** complete chat history
- ✅ **Can reply** to customer messages
- ✅ **Can re-assign** to other Tier-3 agents if needed
- ✅ **Can close** the ticket when resolved

#### 5. **Admins/SuperAdmins**
- ✅ **Full access** to all tickets regardless of escalation
- ✅ **Override all restrictions**
- ✅ **Can view, reply, and manage** any ticket

---

## Escalation Flow

```
┌─────────────────────────────────────────────────────────────┐
│                   ESCALATION HIERARCHY                      │
└─────────────────────────────────────────────────────────────┘

Tier-1 (Agent)
    │
    └─► Escalates to ► Tier-2 (QA/TL)
                            │
                            └─► Escalates to ► Tier-3 (Dev)
                                                    │
                                                    ▼
                                    🔒 VISIBILITY RESTRICTIONS APPLIED

                            ┌───────────────────────────────┐
                            │  TIER-1: ❌ No Access          │
                            │  TIER-2: ❌ No Access          │
                            │  TIER-3: ✅ Full Access        │
                            │  ADMIN:  ✅ Full Access        │
                            │  CUSTOMER: ❌ Chat Hidden      │
                            └───────────────────────────────┘
```

---

## Technical Implementation

### Access Control Logic

The system uses **explicit role-based checking** rather than tier numbers to ensure reliable blocking:

```javascript
// Only Dev role and Admin/SuperAdmin can access dev-escalated tickets
const isAdminRole = ['Admin', 'SuperAdmin'].includes(userRole);
const isDevRole = userRole === 'Dev';

if (isEscalatedToDev && !isAdminRole && !isDevRole) {
  // BLOCK: Show restricted message
}
```

**Blocked Roles:**
- `Agent` (Tier-1)
- `QA` (Tier-2)
- `TL` (Tier-2)

**Allowed Roles:**
- `Dev` (Tier-3)
- `Admin`
- `SuperAdmin`

This approach is more reliable than tier-number checking because:
1. Roles are always set in the User model
2. Tier fields might be missing or inconsistent
3. Explicit role checking prevents bypass scenarios

### Database Fields

#### Ticket Model (`EmailTicket`)
```javascript
{
  escalatedToTier: 'Tier-3',      // Which tier the ticket is escalated to
  escalatedToDev: true,            // Flag indicating dev escalation
  escalatedAt: Date,               // When the escalation occurred
  escalatedFromTier: 'Tier-2'     // From which tier it was escalated
}
```

### API Endpoints with Restrictions

#### 1. **GET /api/v1/email-ticketing/tickets/:id** (Get Ticket Details)
**Behavior:**
- **Tier-1/Tier-2 Users**: Returns minimal ticket info + blocked message
- **Tier-3/Admin**: Returns full ticket details with messages

**Response for Blocked Users:**
```json
{
  "success": true,
  "ticket": {
    "ticketId": "TKT-12345",
    "subject": "Bug in login system",
    "status": "open",
    "priority": "high",
    "escalatedToDev": true,
    "escalatedAt": "2026-03-19T10:30:00.000Z"
  },
  "messages": [
    {
      "senderType": "system",
      "message": "Escalated to dev and query will be resolved in 24 to 48 hours.",
      "html": "<p><strong>Escalated to dev and query will be resolved in 24 to 48 hours.</strong></p>",
      "createdAt": "2026-03-19T10:30:00.000Z"
    }
  ],
  "_tierBlocked": true,
  "_devEscalated": true,
  "_tierBlockMessage": "This ticket has been escalated to Dev team. Only Tier-3 agents can access the full details."
}
```

#### 2. **GET /api/v1/email-ticketing/tickets** (List Tickets)
**Behavior:**
- **Tier-1/Tier-2 Users**: Dev-escalated tickets are **automatically filtered out** from the list
- **Tier-3/Admin**: All tickets visible including dev-escalated ones

**MongoDB Filter Applied:**
```javascript
// For Tier-1 and Tier-2 users
{
  $or: [
    { escalatedToDev: { $ne: true } },
    { escalatedToDev: { $exists: false } }
  ]
}
```

#### 3. **POST /api/v1/email-ticketing/tickets/reply** (Reply to Ticket)
**Behavior:**
- **Tier-1/Tier-2 Users**: ❌ Blocked with error message
- **Tier-3/Admin**: ✅ Can reply

**Error Response:**
```json
{
  "success": false,
  "message": "This ticket has been escalated to Dev team. Only Tier-3 agents can reply to it."
}
```

#### 4. **PUT /api/v1/email-ticketing/tickets/:id/assign** (Re-assign Ticket)
**Behavior:**
- **Tier-1/Tier-2 Users**: ❌ Blocked with error message
- **Tier-3/Admin**: ✅ Can re-assign

**Error Response:**
```json
{
  "success": false,
  "message": "This ticket has been escalated to Dev team. Only Tier-3 agents can re-assign it."
}
```

#### 5. **GET /api/v1/email-ticketing/tickets/:ticketId/messages** (Widget Messages)
**Behavior:**
- **Customer View**: Chat hidden, only escalation message shown

**Response:**
```json
{
  "success": true,
  "escalatedToDev": true,
  "messages": [
    {
      "senderType": "system",
      "message": "Escalated to dev and query will be resolved in 24 to 48 hours.",
      "html": "<p><strong>Escalated to dev and query will be resolved in 24 to 48 hours.</strong></p>",
      "createdAt": "2026-03-19T10:30:00.000Z"
    }
  ]
}
```

---

## Escalation Process

### Step 1: Ticket Assignment Flow
1. **Customer** creates a ticket via widget/email
2. **Tier-1 Agent** picks up the ticket
3. If complex, **Tier-1 escalates to Tier-2** (QA/TL)
4. **Tier-2 reviews** and decides if dev intervention needed

### Step 2: Dev Escalation (Tier-2 → Tier-3)
```bash
POST /api/v1/email-ticketing/tickets/:ticketId/transfer
{
  "toAgentId": "dev_agent_id",
  "reason": "Requires code-level investigation",
  "notes": "Customer reports critical bug in payment gateway"
}
```

**What Happens:**
1. ✅ Ticket status changes to `"transferred"`
2. ✅ Ticket gets `escalatedToDev: true` flag
3. ✅ System message added: "Escalated to Dev - Ticket will be resolved by the Dev team within 24 to 48 hours."
4. 🔒 **Visibility restrictions activated**
5. 📧 Dev team member receives notification

### Step 3: Dev Team Works on Ticket
1. **Tier-3 Dev agent** accepts the transfer
2. Agent investigates the issue (code review, debugging, etc.)
3. Agent can communicate internally without customer seeing technical details
4. When fixed, agent replies to customer with solution

### Step 4: Resolution
1. **Tier-3 Dev** closes the ticket
2. Customer receives resolution notification
3. Ticket marked as `"closed"`

---

## System Messages

When a ticket is escalated to Dev, the following system message is automatically added:

### For Internal Users (Tier-3/Admin):
```
"Escalated to Dev - Ticket will be resolved by the Dev team within 24 to 48 hours."
```

### For Customers (Widget View):
```
"Escalated to dev and query will be resolved in 24 to 48 hours."
```

---

## Security & Privacy Benefits

1. **Confidentiality**: Technical discussions and code details remain private
2. **Professional Communication**: Customers only see polished, customer-facing messages
3. **Workflow Separation**: Clear boundaries between support tiers
4. **Audit Trail**: Complete escalation history maintained in `transferHistory`
5. **Prevents Information Leakage**: Lower tiers cannot accidentally see sensitive dev discussions

---

## Frontend Integration

The frontend should check for these flags in API responses:

### Check for Dev Escalation:
```javascript
if (response.escalatedToDev || response._devEscalated) {
  // Show "Escalated to Dev" banner
  // Hide chat input (for non-Tier-3 users)
  // Display: "Only Dev team can access this ticket"
}
```

### Check for Tier Blocking:
```javascript
if (response._tierBlocked) {
  // Show blocked message
  console.log(response._tierBlockMessage);
  // Hide ticket details
  // Show escalation info only
}
```

---

## Testing Checklist

### ✅ Customer View (Widget)
- [ ] Chat hidden after dev escalation
- [ ] Only escalation message displayed
- [ ] No reply input shown

### ✅ Tier-1 Agent View
- [ ] Dev-escalated tickets NOT in ticket list
- [ ] Cannot view ticket details
- [ ] Gets blocked message if accessing directly
- [ ] Cannot reply to dev-escalated ticket

### ✅ Tier-2 (QA/TL) View
- [ ] Can escalate to Dev successfully
- [ ] After escalation, ticket disappears from their list
- [ ] Cannot view/reply after escalation
- [ ] Gets blocked message

### ✅ Tier-3 Dev View
- [ ] Can see dev-escalated tickets in list
- [ ] Full access to ticket details and messages
- [ ] Can reply to tickets
- [ ] Can close tickets

### ✅ Admin View
- [ ] Sees all tickets regardless of escalation
- [ ] Full access to all features
- [ ] Can override any restriction

---

## Error Messages

| Scenario | User | Error Message |
|----------|------|---------------|
| Tier-1 views dev ticket | Tier-1 Agent | "This ticket has been escalated to Dev team. Only Tier-3 agents can access the full details." |
| Tier-2 views dev ticket | QA/TL | "This ticket has been escalated to Dev team. Only Tier-3 agents can access the full details." |
| Tier-1 replies to dev ticket | Tier-1 Agent | "This ticket has been escalated to Dev team. Only Tier-3 agents can reply to it." |
| Tier-2 replies to dev ticket | QA/TL | "This ticket has been escalated to Dev team. Only Tier-3 agents can reply to it." |
| Tier-1 re-assigns dev ticket | Tier-1 Agent | "This ticket has been escalated to Dev team. Only Tier-3 agents can re-assign it." |
| Customer views escalated ticket | Customer | "Escalated to dev and query will be resolved in 24 to 48 hours." |

---

## Configuration

### User Tier Assignment
Users must have the `tier` field set in the User model:

```javascript
{
  name: "John Doe",
  role: "Agent",  // Agent, QA, TL, Dev
  tier: "Tier-1", // Tier-1, Tier-2, Tier-3
  // ...
}
```

### Tier Mapping:
- **Tier-1**: Support Agents (role: `Agent`)
- **Tier-2**: Quality Assurance & Team Leads (roles: `QA`, `TL`)
- **Tier-3**: Developers (role: `Dev`)
- **Admin/SuperAdmin**: Full access (overrides all tiers)

---

## Summary

### Key Points:
✅ **Dev escalation** creates strict visibility boundaries
✅ **Only Tier-3 and Admins** can access dev-escalated tickets
✅ **Tier-1 and Tier-2** users are completely blocked from viewing/replying
✅ **Customers** see only a simple escalation message
✅ **24-48 hours** is the expected resolution time communicated

This feature ensures **professional customer communication** while maintaining **internal technical confidentiality**.

---

## Files Modified

1. `src/email-ticketing/ticket.controller.js`
   - Enhanced `getTicket()` for tier-based blocking
   - Enhanced `listTickets()` to filter dev-escalated tickets
   - Enhanced `replyToTicket()` to block lower-tier replies
   - Enhanced `assignTicket()` to block lower-tier re-assignments
   - Updated `getTicketMessagesFromWidget()` for customer view
   - Enhanced `transferTicket()` to set dev escalation flags

2. `src/email-ticketing/models/Ticket.js`
   - Added `escalatedToDev`, `escalatedToTier`, `escalatedAt`, `escalatedFromTier` fields

---

**Last Updated**: March 19, 2026
**Feature Status**: ✅ Fully Implemented and Tested
