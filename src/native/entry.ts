import { installNativeTheme } from './theme';
import { installBridge } from './bridge';
import { startController } from './controller';
if ((window as any).__PEN_ROLE__ === 'controller') {
  void startController().catch(error => console.error('TeachersPen startup:', error));
} else {
  installBridge();
  void installNativeTheme().then(() => import('../renderer/index'));
}
