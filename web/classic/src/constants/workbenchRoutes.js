export const WORKBENCH_PATHS = new Set([
  '/dashboard',
  '/channel',
  '/token',
  '/tools',
  '/playground',
  '/image-studio',
  '/video-studio',
  '/image-presets',
  '/redemption',
  '/user',
  '/setting',
  '/personal',
  '/topup',
  '/log',
  '/midjourney',
  '/image-logs',
  '/task',
  '/pricing',
  '/about',
  '/models',
  '/deployment',
  '/subscription',
  '/tool-install-setting',
  '/system-info',
  '/performance',
  '/rankings',
  '/chat',
]);

export const isLegacyConsolePath = (pathname) =>
  pathname === '/console' || pathname.startsWith('/console/');

export const isWorkbenchPath = (pathname) =>
  WORKBENCH_PATHS.has(pathname) || pathname.startsWith('/chat/');

export const isWorkbenchLikePath = (pathname) =>
  isWorkbenchPath(pathname) || isLegacyConsolePath(pathname);
