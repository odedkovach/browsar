// Runner file to invoke purchaceTikcet with given parameters

const { purchaceTikcet } = require('./index3');

(async () => {
    try {
        await purchaceTikcet({
            name: 'Universal Express Pass 7: Mine Cart & Selection',
            quantity: 4,
            date: '2025-5-24'
        });
    } catch (error) {
        console.error('Error running purchaceTikcet:', error);
    }
})();