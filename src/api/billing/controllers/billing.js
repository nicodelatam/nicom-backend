'use strict';

module.exports = {
    async generate(ctx) {
        try {
            const { month, year, limit, city, clienttype, company } = ctx.request.body;

            // Basic validation
            if (!month || !year || !limit || !city || !clienttype || !company) {
                return ctx.badRequest('Missing required parameters');
            }

            // Create the batch record
            const batch = await strapi.entityService.create('api::billing-batch.billing-batch', {
                data: {
                    status: 'pending',
                    progress: 0,
                    total: 0,
                    logs: [],
                    month,
                    year,
                    limit,
                    city,
                    clienttype,
                    company,
                    results: {
                        success: 0,
                        error: 0,
                        skipped: 0
                    }
                }
            });

            // Trigger background processing (do not await)
            strapi.service('api::billing.billing').processBatch(batch.id).catch(err => {
                strapi.log.error(`Error processing batch ${batch.id}:`, err);
            });

            // Return the batch ID immediately
            return ctx.send({ batchId: batch.id });

        } catch (err) {
            strapi.log.error('Billing generation error:', err);
            return ctx.badRequest('Failed to start billing generation', { error: err.message });
        }
    },

    async testConnection(ctx) {
        try {
            const { phone, company } = ctx.request.body;

            if (!phone || !company) {
                return ctx.badRequest('Missing phone or company ID');
            }

            const result = await strapi.service('api::billing.billing').testWhatsappConnection(phone, company);

            return ctx.send(result);
        } catch (err) {
            strapi.log.error('Test connection error:', err);
            return ctx.badRequest('Test connection failed', { error: err.message });
        }
    }
};
