import { registerRootComponent } from 'expo';
// Headless background notification task registration
import './src/services/backgroundTask';
import App from './App';

registerRootComponent(App);
