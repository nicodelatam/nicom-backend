'use strict';

const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

module.exports = ({ strapi }) => {
    let browserInstance = null;

    const getBrowser = async () => {
        if (!browserInstance || !browserInstance.isConnected()) {
            const launchOptions = {
                headless: 'new',
                args: ['--no-sandbox', '--disable-setuid-sandbox']
            };

            // Check for custom executable path (e.g. for ARM servers)
            if (process.env.PUPPETEER_EXECUTABLE_PATH) {
                launchOptions.executablePath = process.env.PUPPETEER_EXECUTABLE_PATH;
            } else if (process.platform === 'linux') {
                // Try to find chromium on common paths if on Linux and no env var set
                const commonPaths = [
                    '/usr/bin/chromium-browser',
                    '/usr/bin/chromium',
                    '/usr/bin/google-chrome-stable'
                ];

                for (const p of commonPaths) {
                    if (fs.existsSync(p)) {
                        launchOptions.executablePath = p;
                        break;
                    }
                }
            }

            try {
                browserInstance = await puppeteer.launch(launchOptions);
            } catch (error) {
                strapi.log.error('Failed to launch browser:', error);
                strapi.log.error('Platform:', process.platform);
                strapi.log.error('Arch:', process.arch);
                strapi.log.error('Launch Options:', JSON.stringify(launchOptions));
                throw error;
            }
        }
        return browserInstance;
    };

    return {
        async generate(invoice, service, company) {
            let page = null;
            try {
                // 1. Load Template
                const templatePath = path.join(process.cwd(), 'public', 'templates', 'invoice.html');
                let html = fs.readFileSync(templatePath, 'utf8');

                // 2. Prepare Data
                const offer = service.offer;
                const today = new Date();
                const limitDate = new Date(invoice.limit);

                const formatDateLong = (date) => {
                    const day = date.getDate();
                    const monthNames = [
                        'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
                        'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'
                    ];
                    const month = monthNames[date.getMonth()];
                    const year = date.getFullYear();
                    return `${day} de ${month} de ${year}`;
                };

                const emissionDateFormatted = formatDateLong(today);
                const limitDateFormatted = formatDateLong(limitDate);
                const currentDateTime = new Date().toLocaleString('es-ES');

                // Calculate total pending (simplified for now, using invoice balance)
                const totalPending = invoice.balance;
                const mainPaymentConcept = `PAGO TOTAL: $${totalPending.toLocaleString('es-CO')} pesos`;

                // 3. Inject Data into HTML
                const replacements = {
                    'id-empresa': company.nit || 'N/A',
                    'direccion-sucursal': company.address || 'N/A',
                    'numero-recibo': invoice.id.toString(),
                    'codigo-usuario': service.code,
                    'fecha-emision': emissionDateFormatted,
                    'fecha-limite': limitDateFormatted,
                    'nombre-cliente': service.client_name,
                    'documento-cliente': service.dni || 'N/A',
                    'servicio-cliente': offer.name,
                    'direccion-cliente': service.address || 'N/A',
                    'barrio-cliente': service.neighborhood || 'N/A',
                    'id-usuario': `CÓDIGO: ${service.code}`,
                    'celular-cliente': service.phone || 'N/A',
                    'email-cliente': service.normalized_client?.email || 'N/A',
                    'plan-contratado': offer.name,
                    'concepto-pago': `${mainPaymentConcept}<br>FACTURA ${invoice.details || 'Mes Actual'} ${invoice.year} $${(invoice.balance || 0).toLocaleString('es-CO')}`,
                    'fecha-pago': currentDateTime,
                    'email-empresa': company.email || 'N/A',
                    'total-pendiente': `TOTAL PENDIENTE POR PAGAR: $${totalPending.toLocaleString('es-CO')} pesos`
                };

                // 4. Get Browser Instance (Singleton)
                const browser = await getBrowser();
                page = await browser.newPage();

                // Set content
                await page.setContent(html, { waitUntil: 'networkidle0' });

                // Inject data via DOM manipulation
                await page.evaluate((data, companyData, cdnUrl) => {
                    // Helper to safely set text content
                    const setText = (id, text) => {
                        const el = document.getElementById(id);
                        if (el) el.innerHTML = text; // Use innerHTML to allow <br>
                    };

                    // Set texts
                    for (const [id, text] of Object.entries(data)) {
                        setText(id, text);
                    }

                    // Handle Logo
                    const logoImg = document.querySelector('.logo img');
                    if (logoImg && companyData.logo && companyData.logo.url) {
                        const url = companyData.logo.url.startsWith('http')
                            ? companyData.logo.url
                            : `${cdnUrl}${companyData.logo.url}`;
                        logoImg.src = url;
                    }

                    // Handle Status Color
                    const estadoPagoEl = document.querySelector('.pagado');
                    if (estadoPagoEl) {
                        // Assuming pending > 0 for generated invoices
                        estadoPagoEl.textContent = 'PENDIENTE';
                        estadoPagoEl.style.borderColor = '#FF0000';
                        estadoPagoEl.style.color = '#FF0000';
                    }

                }, replacements, company, strapi.config.get('server.url') || 'http://localhost:1337');

                // 5. Take Screenshot
                const element = await page.$('.factura-container');
                const imageBuffer = await element.screenshot({
                    type: 'jpeg',
                    quality: 95,
                    omitBackground: false
                });

                // 6. Upload to Strapi
                const fileName = `recibo-${service.code}-${invoice.month}-${invoice.year}.jpg`;

                const uploadService = strapi.plugin('upload').service('upload');

                const tempPath = path.join(process.cwd(), 'public', 'uploads', `temp-${fileName}`);
                fs.writeFileSync(tempPath, imageBuffer);

                const stats = fs.statSync(tempPath);

                const uploadedFiles = await uploadService.upload({
                    data: {
                        refId: invoice.id,
                        ref: 'api::invoice.invoice',
                        field: 'image'
                    },
                    files: {
                        name: fileName,
                        type: 'image/jpeg',
                        size: stats.size,
                        path: tempPath
                    }
                });

                // Cleanup temp file
                fs.unlinkSync(tempPath);

                return uploadedFiles.length > 0 ? uploadedFiles[0] : null;

            } catch (error) {
                strapi.log.error('Image generation error:', error);
                throw error;
            } finally {
                if (page) {
                    await page.close();
                }
            }
        }
    };
};
