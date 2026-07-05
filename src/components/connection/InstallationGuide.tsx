import { useState, useMemo, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import DOMPurify from 'dompurify';
import type {
  AppConfig,
  LocalizedText,
  RemnawaveAppClient,
  RemnawavePlatformData,
  RemnawaveButtonClient,
} from '@/types';
import { useTheme } from '@/hooks/useTheme';
import { CardsBlock, TimelineBlock, AccordionBlock, MinimalBlock, BlockButtons } from './blocks';
import type { BlockRendererProps, RenderBlock } from './blocks';
import TvQuickConnect from './TvQuickConnect';
import { BackIcon, BookOpenIcon, ChevronIcon } from '@/components/icons';
import { cn } from '@/lib/utils';
import '@/styles/connection.css';

const platformOrder = ['ios', 'android', 'windows', 'macos', 'linux', 'androidTV', 'appleTV'];

function detectPlatform(): string | null {
  if (typeof window === 'undefined' || !navigator?.userAgent) return null;
  const ua = navigator.userAgent.toLowerCase();
  if (/iphone|ipad|ipod/.test(ua)) return 'ios';
  if (/android/.test(ua)) return /tv|television/.test(ua) ? 'androidTV' : 'android';
  if (/macintosh|mac os x/.test(ua)) return 'macos';
  if (/windows/.test(ua)) return 'windows';
  if (/linux/.test(ua)) return 'linux';
  return null;
}

const RENDERERS: Record<string, React.ComponentType<BlockRendererProps>> = {
  cards: CardsBlock,
  timeline: TimelineBlock,
  accordion: AccordionBlock,
  minimal: MinimalBlock,
};

/** TV quick-connect is a Happ-only feature (check.happ.su/sendtv) — show it only
 *  for the Happ app, detected by its happ:// deep-link scheme (name as fallback). */
function isHappApp(app: RemnawaveAppClient | null): boolean {
  if (!app) return false;
  if ((app.deepLink ?? '').toLowerCase().startsWith('happ://')) return true;
  return app.name.toLowerCase().includes('happ');
}

interface Props {
  appConfig: AppConfig;
  onOpenDeepLink: (url: string) => void;
  isTelegramWebApp: boolean;
  onGoBack: () => void;
  onOpenQR?: () => void;
}

export default function InstallationGuide({
  appConfig,
  onOpenDeepLink,
  isTelegramWebApp,
  onGoBack,
  onOpenQR,
}: Props) {
  const { t, i18n } = useTranslation();
  const { isLight } = useTheme();

  const detectedPlatform = useMemo(() => detectPlatform(), []);
  const isMobile = typeof window !== 'undefined' && window.innerWidth < 768;

  const [activePlatformKey, setActivePlatformKey] = useState<string | null>(null);
  const [selectedApp, setSelectedApp] = useState<RemnawaveAppClient | null>(null);

  // Reveal stagger — add `.in` to the root after first paint (see connection.css).
  const [revealed, setRevealed] = useState(false);
  useEffect(() => {
    // Double rAF: with a warm query cache the page renders in its first frame
    // and a single rAF fires BEFORE that frame paints — .in would land in the
    // initial paint and the stagger would have nothing to animate from.
    let raf2 = 0;
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => setRevealed(true));
    });
    const fallback = setTimeout(() => setRevealed(true), 90);
    return () => {
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
      clearTimeout(fallback);
    };
  }, []);

  const getLocalizedText = useCallback(
    (text: LocalizedText | undefined): string => {
      if (!text) return '';
      const lang = i18n.language || 'en';
      return text[lang] || text['en'] || text['ru'] || Object.values(text)[0] || '';
    },
    [i18n.language],
  );

  const getBaseTranslation = useCallback(
    (key: string, i18nKey: string): string => {
      const bt = appConfig.baseTranslations;
      if (bt && key in bt) {
        const text = getLocalizedText(bt[key as keyof typeof bt] as LocalizedText);
        if (text) return text;
      }
      return t(i18nKey);
    },
    [appConfig.baseTranslations, getLocalizedText, t],
  );

  const getSvgHtml = useCallback(
    (svgKey: string | undefined): string => {
      if (!svgKey || !appConfig.svgLibrary?.[svgKey]) return '';
      const entry = appConfig.svgLibrary[svgKey];
      const raw = typeof entry === 'string' ? entry : entry.svgString;
      if (!raw) return '';
      return DOMPurify.sanitize(raw, { USE_PROFILES: { svg: true, svgFilters: true } });
    },
    [appConfig.svgLibrary],
  );

  const availablePlatforms = useMemo(() => {
    if (!appConfig.platforms) return [];
    const available = platformOrder.filter((key) => {
      const data = appConfig.platforms[key] as RemnawavePlatformData | undefined;
      return data && data.apps && data.apps.length > 0;
    });
    if (detectedPlatform && available.includes(detectedPlatform)) {
      return [detectedPlatform, ...available.filter((p) => p !== detectedPlatform)];
    }
    return available;
  }, [appConfig.platforms, detectedPlatform]);

  useEffect(() => {
    if (selectedApp || !availablePlatforms.length) return;
    const platform = availablePlatforms[0];
    const data = appConfig.platforms[platform] as RemnawavePlatformData | undefined;
    if (!data?.apps?.length) return;
    const app = data.apps.find((a) => a.featured) || data.apps[0];
    if (app) {
      setSelectedApp(app);
      setActivePlatformKey(platform);
    }
  }, [appConfig.platforms, availablePlatforms, selectedApp]);

  const renderBlockButtons = useCallback(
    (buttons: RemnawaveButtonClient[] | undefined, variant: 'light' | 'subtle') => (
      <BlockButtons
        buttons={buttons}
        variant={variant}
        isLight={isLight}
        subscriptionUrl={appConfig.subscriptionUrl}
        hideLink={appConfig.hideLink}
        deepLink={selectedApp?.deepLink}
        getLocalizedText={getLocalizedText}
        getBaseTranslation={getBaseTranslation}
        getSvgHtml={getSvgHtml}
        onOpenDeepLink={onOpenDeepLink}
      />
    ),
    [
      appConfig.subscriptionUrl,
      appConfig.hideLink,
      selectedApp?.deepLink,
      isLight,
      getLocalizedText,
      getBaseTranslation,
      getSvgHtml,
      onOpenDeepLink,
    ],
  );

  const userIsOnTv = detectedPlatform === 'androidTV' || detectedPlatform === 'appleTV';
  // Happ's TV quick-connect (check.happ.su/sendtv) is ONE API serving BOTH
  // Android TV and Apple TV — show the widget on either.
  const selectedPlatform = activePlatformKey || availablePlatforms[0];
  const isTvLayout =
    (selectedPlatform === 'androidTV' || selectedPlatform === 'appleTV') && !userIsOnTv;

  const currentPlatformKey = activePlatformKey || availablePlatforms[0];
  const currentPlatformData = currentPlatformKey
    ? (appConfig.platforms[currentPlatformKey] as RemnawavePlatformData | undefined)
    : undefined;
  const currentPlatformApps = currentPlatformData?.apps || [];

  // Platform display name
  const getPlatformDisplayName = useCallback(
    (key: string): string => {
      const data = appConfig.platforms[key] as RemnawavePlatformData | undefined;
      if (data?.displayName) {
        const name = getLocalizedText(data.displayName);
        if (name) return name;
      }
      if (appConfig.platformNames?.[key]) {
        return getLocalizedText(appConfig.platformNames[key]);
      }
      const fallback: Record<string, string> = {
        ios: 'iOS',
        android: 'Android',
        windows: 'Windows',
        macos: 'macOS',
        linux: 'Linux',
        androidTV: 'Android TV',
        appleTV: 'Apple TV',
      };
      return fallback[key] || key;
    },
    [appConfig.platforms, appConfig.platformNames, getLocalizedText],
  );

  // Platform SVG icon for dropdown
  const currentPlatformSvg = getSvgHtml(currentPlatformData?.svgIconKey);

  // Block renderer
  const blockType = appConfig.uiConfig?.installationGuidesBlockType || 'cards';
  const Renderer = RENDERERS[blockType] || CardsBlock;

  // For the Happ TV app (Android TV / Apple TV), inject the TV connect widget as
  // customNode so it renders THROUGH the active block style (cards/timeline/
  // accordion/minimal) instead of as separate clashing cards that break it.
  const showTvConnect = Boolean(
    selectedApp && isTvLayout && isHappApp(selectedApp) && appConfig.subscriptionUrl,
  );
  let renderBlocks: RenderBlock[] = selectedApp?.blocks ?? [];
  if (selectedApp && showTvConnect && appConfig.subscriptionUrl) {
    // install → add-subscription → connect: attach to the add step (index 1);
    // fall back to the last block for shorter configs.
    const idx = selectedApp.blocks.length >= 3 ? 1 : Math.max(0, selectedApp.blocks.length - 1);
    const widget = <TvQuickConnect subscriptionUrl={appConfig.subscriptionUrl} isLight={isLight} />;
    renderBlocks = selectedApp.blocks.map((b, i) => (i === idx ? { ...b, customNode: widget } : b));
  }

  return (
    <div className={cn('mitray-conn', revealed && 'in')}>
      {/* Head: breadcrumb + title + QR + platform select */}
      <div className="conn-crumb">
        {t('nav.cabinet', 'Кабинет')} ·{' '}
        <b>{t('subscription.connection.breadcrumb', 'Подключение')}</b>
      </div>
      <div className="conn-title-row">
        {!isTelegramWebApp && (
          <button onClick={onGoBack} aria-label={t('common.back', 'Back')} className="conn-back">
            <BackIcon className="h-6 w-6" />
          </button>
        )}
        <h1>{getBaseTranslation('installationGuideHeader', 'subscription.connection.title')}</h1>
        {appConfig.subscriptionUrl && onOpenQR && (
          <button
            onClick={() => onOpenQR()}
            aria-label={t('subscription.connection.openQr', 'Open QR code')}
            className="qrbtn"
          >
            <svg
              width="22"
              height="22"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.8}
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <rect x="3" y="3" width="7" height="7" rx="1.5" />
              <rect x="14" y="3" width="7" height="7" rx="1.5" />
              <rect x="3" y="14" width="7" height="7" rx="1.5" />
              <path d="M14 14h3v3M21 14v.01M17 21h.01M21 17v4" />
            </svg>
          </button>
        )}
        {availablePlatforms.length > 1 && (
          <div className="plat">
            {currentPlatformSvg && (
              <span className="pico" dangerouslySetInnerHTML={{ __html: currentPlatformSvg }} />
            )}
            <select
              value={currentPlatformKey || ''}
              onChange={(e) => {
                const newPlatform = e.target.value;
                setActivePlatformKey(newPlatform);
                const data = appConfig.platforms[newPlatform] as RemnawavePlatformData | undefined;
                if (data?.apps?.length) {
                  // Keep the user's current app (by name) if it also exists on the
                  // new platform; only fall back to featured/first otherwise.
                  const app =
                    data.apps.find((a) => a.name === selectedApp?.name) ||
                    data.apps.find((a) => a.featured) ||
                    data.apps[0];
                  if (app) setSelectedApp(app);
                }
              }}
              style={currentPlatformSvg ? undefined : { paddingLeft: 18 }}
            >
              {availablePlatforms.map((p) => (
                <option key={p} value={p}>
                  {getPlatformDisplayName(p)}
                </option>
              ))}
            </select>
            <span className="pchev">
              <ChevronIcon className="h-[14px] w-[14px]" />
            </span>
          </div>
        )}
      </div>

      {/* App chips */}
      {currentPlatformApps.length > 0 && (
        <div className="apps">
          {currentPlatformApps.map((app, idx) => {
            const isSelected = selectedApp?.name === app.name;
            const appIconSvg = getSvgHtml(app.svgIconKey);
            return (
              <button
                key={app.name + idx}
                onClick={() => setSelectedApp(app)}
                className={cn('app', isSelected && 'on')}
              >
                {app.featured && <span className="dot" />}
                <span className="an">{app.name}</span>
                {appIconSvg && (
                  <span className="alogo" dangerouslySetInnerHTML={{ __html: appIconSvg }} />
                )}
              </button>
            );
          })}
        </div>
      )}

      {/* Tutorial button */}
      {appConfig.baseSettings?.isShowTutorialButton && appConfig.baseSettings?.tutorialUrl && (
        <a
          href={appConfig.baseSettings.tutorialUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="conn-tut"
        >
          <BookOpenIcon className="h-5 w-5" />
          {getBaseTranslation('tutorial', 'subscription.connection.tutorial')}
        </a>
      )}

      {/* Blocks rendered in the panel's active style (Remnawave-driven). For the
          Happ Android TV app the TV connect widget is injected into a step
          (customNode), so it adapts to that style instead of breaking it. */}
      {selectedApp && (
        <div className="reveal d1">
          <Renderer
            blocks={renderBlocks}
            isMobile={isMobile}
            isLight={isLight}
            getLocalizedText={getLocalizedText}
            getSvgHtml={getSvgHtml}
            renderBlockButtons={renderBlockButtons}
          />
        </div>
      )}
    </div>
  );
}
