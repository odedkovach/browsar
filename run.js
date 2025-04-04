// Runner file to invoke purchaceTikcet with given parameters

const { purchaceTikcet } = require('./index3');

(async () => {
    try {
        await purchaceTikcet('Universal Express Pass 4: Fun Variety', 2, '2025-5-31');
    } catch (error) {
        console.error('Error running purchaceTikcet:', error);
    }
})();