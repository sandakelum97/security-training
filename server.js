// Local / Docker / any Node host entry point. On Vercel, api/index.js is used instead.
import { app } from './src/app.js';

const port = Number(process.env.PORT || 3000);
app.listen(port, () => console.log(`Training platform running on http://localhost:${port}`));
