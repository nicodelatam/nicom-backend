'use strict';

const fetch = require('node-fetch');

module.exports = ({ strapi }) => ({

    async processBatch(batchId) {
        const batch = await strapi.entityService.findOne('api::billing-batch.billing-batch', batchId, {
            populate: ['city', 'clienttype', 'company']
        });

        if (!batch) {
            strapi.log.error(`Batch ${batchId} not found`);
            return;
        }

        try {
            // Update status to processing
            await strapi.entityService.update('api::billing-batch.billing-batch', batchId, {
                data: { status: 'processing', logs: [`Inicio del proceso: ${new Date().toLocaleString()}`] }
            });

            const { month, year, limit, city, clienttype, company, serviceIds } = batch;

            // Build filters
            const filters = {
                active: true,
                indebt: false,
                city: city.id,
                clienttype: clienttype.id,
            };

            // If specific services were selected, filter by them
            if (serviceIds && Array.isArray(serviceIds) && serviceIds.length > 0) {
                filters.id = { $in: serviceIds };
            }

            // Fetch active services
            const services = await strapi.entityService.findMany('api::service.service', {
                filters,
                populate: ['offer', 'clienttype', 'city', 'company', 'normalized_client'], // Populate needed fields
                limit: -1 // Fetch all
            });

            // Update total
            await strapi.entityService.update('api::billing-batch.billing-batch', batchId, {
                data: { total: services.length }
            });

            let processed = 0;
            const results = { success: 0, error: 0, skipped: 0 };
            const logs = [`Total servicios a procesar: ${services.length}`];
            const startTime = Date.now();

            // Helper for concurrency
            const runInBatches = async (items, batchSize, fn) => {
                for (let i = 0; i < items.length; i += batchSize) {
                    const chunk = items.slice(i, i + batchSize);
                    const chunkStartTime = Date.now();

                    await Promise.all(chunk.map(item => fn(item)));

                    const chunkDuration = Date.now() - chunkStartTime;
                    processed += chunk.length;

                    // Log progress
                    const progressMsg = `Procesados ${Math.min(processed, items.length)}/${items.length} (Lote de ${chunk.length} en ${chunkDuration}ms)`;
                    logs.push(progressMsg);

                    // Update DB every batch (or every few batches if very fast)
                    await strapi.entityService.update('api::billing-batch.billing-batch', batchId, {
                        data: { progress: processed, logs: logs }
                    });
                }
            };

            // Process function for a single service
            const processService = async (service) => {
                try {
                    // 1. Check if invoice already exists
                    const existingInvoices = await strapi.entityService.findMany('api::invoice.invoice', {
                        filters: {
                            service: service.id,
                            month: month,
                            year: year,
                            type: 'FACTURA' // Assuming type check
                        }
                    });

                    if (existingInvoices.length > 0) {
                        results.skipped++;
                        // logs.push(`Service ${service.code}: Skipped (Already billed)`); // Reduce noise
                        return;
                    }

                    // 2. Check for Offer
                    if (!service.offer) {
                        results.skipped++;
                        logs.push(`Service ${service.code}: Skipped (No offer)`);
                        return;
                    }

                    // 3. Create Invoice
                    const invoiceData = {
                        balance: service.offer.price,
                        value: service.offer.price,
                        month: month,
                        year: year,
                        type: 'FACTURA',
                        offer: service.offer.id,
                        concept: 'FACTURACION MENSUAL',
                        details: `Factura ${month}/${year}`,
                        payed: false,
                        partial: false,
                        indebt: false,
                        service: service.id,
                        invoice_type: 1,
                        limit: limit,
                        company: company.id,
                        publishedAt: new Date(),
                    };

                    const invoice = await strapi.entityService.create('api::invoice.invoice', {
                        data: invoiceData
                    });

                    // 3.5 Generate Image
                    let imageUrl = null;
                    try {
                        const image = await strapi.service('api::billing.image-generator').generate(invoice, service, company);
                        if (image && image.url) {
                            const baseUrl = strapi.config.get('server.url') || 'http://localhost:1337';
                            imageUrl = image.url.startsWith('http') ? image.url : `${baseUrl}${image.url}`;
                        }
                    } catch (imgErr) {
                        strapi.log.error(`Image generation failed for ${service.code}:`, imgErr);
                        logs.push(`Service ${service.code}: Image generation failed - ${imgErr.message}`);
                    }

                    // 4. Send WhatsApp
                    if (company.meta_token && company.meta_endpoint && company.meta_template) {
                        try {
                            await this.sendWhatsapp(service, invoice, company, month, limit, imageUrl);
                            await strapi.entityService.update('api::invoice.invoice', invoice.id, {
                                data: {
                                    whatsapp_status: 'SENT',
                                    whatsapp_attempted_at: new Date(),
                                }
                            });
                        } catch (waError) {
                            strapi.log.error(`WhatsApp error for ${service.code}:`, waError);
                            logs.push(`Service ${service.code}: Invoice created, WhatsApp failed - ${waError.message}`);
                            await strapi.entityService.update('api::invoice.invoice', invoice.id, {
                                data: {
                                    whatsapp_status: 'FAILED',
                                    whatsapp_error_message: waError.message,
                                    whatsapp_attempted_at: new Date(),
                                }
                            });
                        }
                    }

                    results.success++;

                } catch (err) {
                    strapi.log.error(`Error processing service ${service.id}:`, err);
                    results.error++;
                    logs.push(`Service ${service.code || service.id}: Error - ${err.message}`);
                }
            };

            // Run with concurrency of 10
            await runInBatches(services, 10, processService);

            const totalTime = Date.now() - startTime;
            logs.push(`Proceso finalizado en ${(totalTime / 1000).toFixed(2)} segundos.`);

            // Final update
            await strapi.entityService.update('api::billing-batch.billing-batch', batchId, {
                data: {
                    status: 'completed',
                    progress: processed,
                    results,
                    logs: logs
                }
            });

        } catch (err) {
            strapi.log.error(`Batch ${batchId} failed:`, err);
            await strapi.entityService.update('api::billing-batch.billing-batch', batchId, {
                data: {
                    status: 'failed',
                    logs: [`Batch failed: ${err.message}`]
                }
            });
        }
    },

    async sendWhatsapp(service, invoice, company, month, limit, imageUrl) {
        const phoneNumber = service.phone; // Or normalized_client.phone

        if (!phoneNumber) {
            throw new Error('No phone number');
        }

        // Format Date (Spanish)
        // Assuming limit is YYYY-MM-DD
        const dateParts = limit.split('-');
        const monthNames = [
            'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
            'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'
        ];
        let formattedDate = limit;
        if (dateParts.length === 3) {
            const day = parseInt(dateParts[2], 10);
            const monthIndex = parseInt(dateParts[1], 10) - 1;
            formattedDate = `${day} de ${monthNames[monthIndex]}`;
        }

        // Month Name
        const monthName = monthNames[month - 1] || 'Mes Actual';

        const body = {
            messaging_product: 'whatsapp',
            recipient_type: 'individual',
            to: `57${phoneNumber}`,
            type: 'template',
            template: {
                name: company.meta_template,
                language: {
                    code: 'es_CO'
                },
                components: [
                    {
                        type: 'header',
                        parameters: [
                            {
                                type: 'image',
                                image: {
                                    // Use generated image or fallback
                                    link: imageUrl
                                }
                            }
                        ]
                    },
                    {
                        type: 'body',
                        parameters: [
                            {
                                type: 'text',
                                text: monthName
                            },
                            {
                                type: 'text',
                                text: formattedDate
                            }
                        ]
                    }
                ]
            }
        }; 

        const url = `${company.meta_endpoint}/${company.meta_api_version}/${company.meta_phone_id}/messages`

        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${company.meta_token}`
            },
            body: JSON.stringify(body)
        });

        const data = await response.json();

        if (data.error) {
            throw new Error(data.error.message);
        }

        return data;
    },

    async testWhatsappConnection(phone, companyId) {
        const company = await strapi.entityService.findOne('api::company.company', companyId);
        if (!company) throw new Error('Company not found');

        // Mock service/invoice for test
        const mockService = { phone: phone };
        const mockInvoice = {};
        const today = new Date();
        const limit = today.toISOString().split('T')[0];
        const month = today.getMonth() + 1;

        return this.sendWhatsapp(mockService, mockInvoice, company, month, limit);
    }
});
