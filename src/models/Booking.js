const mongoose = require('mongoose');
const getIndiaTime = require('../utils/timezone');

const BookingSchema = new mongoose.Schema({
    organizationId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Organization',
        required: true
    },
    customer: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    pnr: {
        type: String,
        required: true,
        uppercase: true,
        trim: true,
        index: true
    },
    ticketNumber: {
        type: String,
        required: true,
        trim: true,
        unique: true
    },
    airlineCode: {
        type: String,
        required: true,
        uppercase: true,
        trim: true
    },
    flightNumber: {
        type: String,
        required: true,
        uppercase: true,
        trim: true
    },
    travelDate: {
        type: Date,
        required: true
    },
    route: {
        from: { type: String, required: true, uppercase: true, trim: true }, // Airport Code (e.g., DEL)
        to: { type: String, required: true, uppercase: true, trim: true }    // Airport Code (e.g., DXB)
    },
    cabinClass: {
        type: String,
        enum: ['Economy', 'Premium Economy', 'Business', 'First'],
        required: true
    },
    fareType: {
        type: String,
        enum: ['Refundable', 'Non-refundable', 'Semi-Flexible'],
        required: true
    },
    bookingChannel: {
        type: String,
        enum: ['Website', 'Mobile App', 'Agent', 'OTA', 'Counter'],
        default: 'Website'
    },
    passengerName: {
        type: String,
        required: true,
        trim: true
    },
    status: {
        type: String,
        enum: ['Confirmed', 'Hold', 'Cancelled', 'Flown', 'No Show'],
        default: 'Confirmed'
    },
    fareAmount: {
        currency: { type: String, default: 'USD' },
        total: { type: Number, required: true }
    },
    createdAt: {
        type: Date,
        default: getIndiaTime
    },
    updatedAt: {
        type: Date,
        default: getIndiaTime
    }
}, { timestamps: true });

// Compound Indexes for fast searching
BookingSchema.index({ organizationId: 1, pnr: 1 });
BookingSchema.index({ organizationId: 1, ticketNumber: 1 });
BookingSchema.index({ customer: 1 });

module.exports = mongoose.model('Booking', BookingSchema);
