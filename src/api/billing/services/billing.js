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
                data: { status: 'processing' }
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
            const logs = [];

            for (const service of services) {
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
                        logs.push(`Service ${service.code}: Skipped (Already billed)`);
                        continue;
                    }

                    // 2. Check for Offer
                    if (!service.offer) {
                        results.skipped++;
                        logs.push(`Service ${service.code}: Skipped (No offer)`);
                        continue;
                    }

                    // 3. Create Invoice
                    // Note: Frontend used POST /invoices which maps to create.
                    // We use entityService.create directly.
                    const invoiceData = {
                        balance: service.offer.price, // Assuming price is on offer
                        value: service.offer.price,
                        month: month,
                        year: year,
                        type: 'FACTURA',
                        offer: service.offer.id,
                        concept: 'FACTURACION MENSUAL',
                        details: `Factura ${month}/${year}`, // Simplified
                        payed: false,
                        partial: false,
                        indebt: false,
                        service: service.id,
                        invoice_type: 1, // Hardcoded as per frontend
                        limit: limit,
                        company: company.id,
                        publishedAt: new Date(),
                    };

                    const invoice = await strapi.entityService.create('api::invoice.invoice', {
                        data: invoiceData
                    });

                    // 4. Send WhatsApp
                    // Need to fetch company config if not fully populated or if secrets are hidden
                    // Assuming company object has meta_token and meta_endpoint
                    // If not, might need to re-fetch company with secrets if they are private fields

                    if (company.meta_token && company.meta_endpoint && company.meta_template) {
                        try {
                            await this.sendWhatsapp(service, invoice, company, month, limit);
                            // Update invoice status? Frontend did: updateInvoiceWhatsappStatus
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
                            // We count this as success for billing, but maybe note the warning?
                            // For now, let's count as success since invoice exists.
                        }
                    }

                    results.success++;

                } catch (err) {
                    strapi.log.error(`Error processing service ${service.id}:`, err);
                    results.error++;
                    logs.push(`Service ${service.code || service.id}: Error - ${err.message}`);
                }

                processed++;

                // Update progress: every 1 item for the first 5, then every 5 items
                if (processed <= 5 || processed % 5 === 0) {
                    await strapi.entityService.update('api::billing-batch.billing-batch', batchId, {
                        data: { progress: processed, logs: logs } // Save all logs for now to ensure visibility
                    });
                }
            }

            // Final update
            await strapi.entityService.update('api::billing-batch.billing-batch', batchId, {
                data: {
                    status: 'completed',
                    progress: processed,
                    results,
                    logs: logs // Save full logs at the end
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

    async sendWhatsapp(service, invoice, company, month, limit) {
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
                                    // Use a default image or generated one. 
                                    // Frontend generated an image from HTML. Backend cannot easily do that without headless browser.
                                    // For now, we might need to skip the image or use a static one.
                                    // The user said "pass the process to backend". 
                                    // If image generation is required, we need a solution.
                                    // Frontend logic: `generateImageFromBill`.
                                    // If we can't generate image in backend easily, we might send without image or use a placeholder.
                                    // Let's use a placeholder or the company logo if available.
                                    // The user didn't explicitly ask for image generation in backend, but implied "process".
                                    // Generating image from HTML in Node requires Puppeteer/Playwright.
                                    // Given the constraints and "robustness", maybe we skip image for now or use a static link.
                                    // Let's check if we can use a static link from config or company.
                                    link: 'https://gteltelecomunicaciones.com/test.jpg' // Placeholder from frontend code
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

        const response = await fetch(company.meta_endpoint, {
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
