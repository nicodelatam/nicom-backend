'use strict';

const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

module.exports = ({ strapi }) => ({
    async generate(invoice, service, company) {
        let browser = null;
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
            // Using simple string replacement for now. A template engine like EJS would be better but keeping it simple.
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

            // Replace content by ID
            // This is a bit hacky with regex but works for the specific template structure
            // Better approach: Use Cheerio or just replace placeholders if we modified the template to use {{key}}
            // Since we are using the frontend template which uses IDs, we'll use a simple approach:
            // We will launch Puppeteer, load the HTML, and then use page.evaluate to update the DOM!
            // This is much more robust than regex on HTML string.

            // 4. Launch Puppeteer
            browser = await puppeteer.launch({
                headless: 'new',
                args: ['--no-sandbox', '--disable-setuid-sandbox'] // Required for some environments
            });
            const page = await browser.newPage();

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
            if (browser) {
                await browser.close();
            }
        }
    }
});
