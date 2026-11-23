import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { AppRoutes } from '../../web/App';
import 'bootstrap/dist/css/bootstrap.min.css';
import '../../web/styles.css';
createRoot(document.getElementById('root')!).render(<BrowserRouter><AppRoutes/></BrowserRouter>);
