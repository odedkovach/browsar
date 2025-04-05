// Runner file to invoke purchaceTikcet with given parameters

const { purchaceTikcet } = require('./index3');

(async () => {
    try {
        await purchaceTikcet({
            name: 'Universal Express Pass 4: 4D & Choice',
            quantity: 2,
            date: '2025-5-31'
        });
    } catch (error) {
        console.error('Error running purchaceTikcet:', error);
    }
})();