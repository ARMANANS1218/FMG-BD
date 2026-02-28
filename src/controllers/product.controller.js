const Product = require('../models/Product');

// 1. Create a new Product
exports.createProduct = async (req, res) => {
    try {
        const { productName, brand, skuCode, category, isActive } = req.body;
        const bodyOrgId = req.body.organizationId;

        // Grab organizationId from body OR fallback to the logged-in user's organizationId
        const organizationId = bodyOrgId || req.user?.organizationId;

        if (!organizationId) {
            return res.status(400).json({ status: false, message: 'Organization ID is required' });
        }

        const existingProduct = await Product.findOne({ skuCode });
        if (existingProduct) {
            return res.status(400).json({ status: false, message: 'SKU Code already exists' });
        }

        const createdBy = req.user?.id || req.user?._id || null;

        const newProduct = await Product.create({
            organizationId,
            productName,
            brand,
            skuCode,
            category,
            isActive: isActive !== undefined ? isActive : true,
            createdBy,
        });

        res.status(201).json({
            status: true,
            message: 'Product created successfully',
            data: newProduct
        });
    } catch (error) {
        console.error('Create Product Error:', error);
        res.status(500).json({ status: false, message: 'Failed to create product', error: error.message });
    }
};

// 2. Get all Products (Search & Filter)
exports.getAllProducts = async (req, res) => {
    try {
        const { search, category, isActive, organizationId } = req.query;
        let query = {};

        // Filter by organization (for multi-tenant support)
        const orgId = organizationId || req.user?.organizationId;
        if (orgId) {
            query.organizationId = orgId;
        }

        // Text search (name or SKU)
        if (search) {
            query.$or = [
                { productName: { $regex: search, $options: 'i' } },
                { skuCode: { $regex: search, $options: 'i' } }
            ];
        }

        // Exact match category filter
        if (category) {
            query.category = category;
        }

        // Active Status filter
        if (isActive !== undefined) {
            query.isActive = isActive === 'true';
        }

        const products = await Product.find(query).sort({ createdAt: -1 });

        res.status(200).json({ status: true, data: products, count: products.length });
    } catch (error) {
        console.error('Get Products Error:', error);
        res.status(500).json({ status: false, message: 'Failed to get products', error: error.message });
    }
};

// 3. Get single product by ID
exports.getProductById = async (req, res) => {
    try {
        const product = await Product.findById(req.params.id);

        if (!product) {
            return res.status(404).json({ status: false, message: 'Product not found' });
        }

        res.status(200).json({ status: true, data: product });
    } catch (error) {
        console.error('Get Product By ID Error:', error);
        res.status(500).json({ status: false, message: 'Failed to fetch product', error: error.message });
    }
};

// 4. Update Product
exports.updateProduct = async (req, res) => {
    try {
        const { productName, brand, skuCode, category, isActive } = req.body;

        if (skuCode) {
            const existingWithSku = await Product.findOne({ skuCode, _id: { $ne: req.params.id } });
            if (existingWithSku) {
                return res.status(400).json({ status: false, message: 'SKU Code already in use by another product' });
            }
        }

        const updatedProduct = await Product.findByIdAndUpdate(
            req.params.id,
            { productName, brand, skuCode, category, isActive },
            { new: true, runValidators: true }
        );

        if (!updatedProduct) {
            return res.status(404).json({ status: false, message: 'Product not found' });
        }

        res.status(200).json({
            status: true,
            message: 'Product updated successfully',
            data: updatedProduct
        });
    } catch (error) {
        console.error('Update Product Error:', error);
        res.status(500).json({ status: false, message: 'Failed to update product', error: error.message });
    }
};

// 5. Soft Delete Product
exports.deleteProduct = async (req, res) => {
    try {
        const product = await Product.findByIdAndUpdate(
            req.params.id,
            { isActive: false },
            { new: true }
        );

        if (!product) {
            return res.status(404).json({ status: false, message: 'Product not found' });
        }

        res.status(200).json({
            status: true,
            message: 'Product soft deleted (deactivated) successfully',
            data: product
        });
    } catch (error) {
        console.error('Delete Product Error:', error);
        res.status(500).json({ status: false, message: 'Failed to delete product', error: error.message });
    }
};

// 6. Bulk Import Products
exports.bulkImportProducts = async (req, res) => {
    try {
        // Support array directly or inside a "products" property
        const productsArray = Array.isArray(req.body) ? req.body : req.body.products;

        if (!productsArray || !Array.isArray(productsArray) || productsArray.length === 0) {
            return res.status(400).json({ status: false, message: 'A valid products array is required' });
        }

        const orgId = req.user?.organizationId;
        if (!orgId) {
            return res.status(400).json({ status: false, message: 'Organization ID is required for bulk import' });
        }

        const createdBy = req.user?.id || req.user?._id || null;

        let successCount = 0;
        let errors = [];

        // Validate and insert iteratively for detailed error tracking
        const operations = productsArray.map(async (item, index) => {
            try {
                if (!item.productName || !item.skuCode || !item.brand) {
                    errors.push({ index, skuCode: item.skuCode, error: "Missing required fields (productName, skuCode, brand)" });
                    return;
                }

                const existingProduct = await Product.findOne({ skuCode: item.skuCode });
                if (existingProduct) {
                    errors.push({ index, skuCode: item.skuCode, error: 'SKU Code already exists' });
                    return;
                }

                await Product.create({
                    organizationId: orgId,
                    productName: item.productName,
                    brand: item.brand,
                    skuCode: item.skuCode,
                    category: item.category,
                    isActive: item.isActive !== undefined ? item.isActive : true,
                    createdBy,
                });

                successCount++;
            } catch (err) {
                errors.push({ index, skuCode: item.skuCode, error: err.message });
            }
        });

        await Promise.all(operations);

        res.status(201).json({
            status: true,
            message: `Bulk import completed. ${successCount} successfully imported.`,
            successCount,
            errorCount: errors.length,
            errors: errors.length > 0 ? errors : undefined
        });

    } catch (error) {
        console.error('Bulk Import Error:', error);
        res.status(500).json({ status: false, message: 'Failed to process bulk import', error: error.message });
    }
};
