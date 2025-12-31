module.exports = {
    routes: [
        {
            method: 'POST',
            path: '/billing/generate',
            handler: 'billing.generate',
            config: {
                policies: [],
                middlewares: [],
            },
        },
        {
            method: 'POST',
            path: '/billing/test-connection',
            handler: 'billing.testConnection',
            config: {
                policies: [],
                middlewares: [],
            },
        },
    ],
};
