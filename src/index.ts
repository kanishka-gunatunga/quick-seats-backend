import express from 'express';
import dotenv from 'dotenv';
import cors from 'cors';
import userRoutes from './routes/user.routes';

dotenv.config();
const app = express();;
app.use(cors());
app.use(express.json()); 

app.use('/api/users', userRoutes); 


const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
