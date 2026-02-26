const mongoose = require('mongoose');

const CustomerSchema = new mongoose.Schema(
    {
        contactId: {
            type: String,
            unique: true,
            index: true,
        },
        fullName: {
            type: String,
            required: true,
            trim: true,
        },
        email: {
            type: String,
            required: true,
            lowercase: true,
            trim: true,
            unique: true,
        },
        phone: {
            type: String,
            trim: true,
            validate: {
                validator: function (v) {
                    if (!v) return true;
                    return /^\d{10}$/.test(v);
                },
                message: (props) => `${props.value} is not a valid phone number`,
            },
        },
        alternateContact: {
            type: String,
            trim: true,
            default: null,
        },
        postcode: {
            type: String,
            trim: true,
            default: null,
        },
        address: {
            type: String,
            trim: true,
            default: null,
        },
        city: {
            type: String,
            trim: true,
            default: null,
        },
        region: {
            type: String,
            trim: true,
            default: null,
        },
        preferredContactMethod: {
            type: String,
            enum: ['Chat', 'Email', 'Phone'],
            default: 'Email',
        },
        consentGiven: {
            type: Boolean,
            default: false,
        },
        consentTimestamp: {
            type: Date,
            default: null,
        },
        vulnerableCustomer: {
            type: Boolean,
            default: false,
        },
        customerType: {
            type: String,
            trim: true,
            enum: ['End Consumer', 'Retailer', 'Distributor', 'Online Buyer'],
            default: 'End Consumer',
        },
    },
    { timestamps: true }
);

// Auto-generate contactId before saving
CustomerSchema.pre('save', function (next) {
    if (this.isNew && !this.contactId) {
        // Generate an automatic contact ID if not provided (e.g., CT-12345678)
        const randomDigits = Math.floor(10000000 + Math.random() * 90000000);
        this.contactId = `CT-${randomDigits}`;
    }
    next();
});

module.exports = mongoose.model('Customer', CustomerSchema);