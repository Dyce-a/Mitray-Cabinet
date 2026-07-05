import { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { PiCaretDown } from 'react-icons/pi';
import DOMPurify from 'dompurify';
import { infoApi, FaqPage, InfoVisibility } from '../api/info';
import { infoPagesApi } from '../api/infoPages';
import { promoApi, LoyaltyTierInfo } from '../api/promo';
import type { FaqItem, ReplacesTab } from '../api/infoPages';
import { DocumentIcon, InfoIcon, QuestionIcon, ShieldIcon, StarIcon } from '@/components/icons';
import { cn } from '@/lib/utils';
import '../styles/info.css';

const ChevronIcon = ({ expanded }: { expanded: boolean }) => (
  <PiCaretDown className={`h-5 w-5 transition-transform ${expanded ? 'rotate-180' : ''}`} />
);

const Spinner = () => (
  <div className="loader">
    <div className="spin" />
  </div>
);

const BUILTIN_TABS = new Set<string>(['faq', 'rules', 'privacy', 'offer', 'loyalty']);

// Sanitize HTML content to prevent XSS
const sanitizeHtml = (html: string): string => {
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS: [
      'p',
      'br',
      'b',
      'i',
      'u',
      'strong',
      'em',
      'a',
      'ul',
      'ol',
      'li',
      'h1',
      'h2',
      'h3',
      'h4',
      'h5',
      'h6',
      'blockquote',
      'code',
      'pre',
      's',
      'del',
      'ins',
      'span',
      'div',
      'tg-spoiler',
    ],
    ALLOWED_ATTR: ['href', 'target', 'rel', 'class', 'start'],
    ALLOW_DATA_ATTR: false,
  });
};

// Rich sanitizer for custom InfoPage content (TipTap editor output with media)
const ALLOWED_IFRAME_HOSTS = new Set([
  'www.youtube.com',
  'youtube.com',
  'player.vimeo.com',
  'www.youtube-nocookie.com',
]);

const infoPagePurify = DOMPurify(window);

infoPagePurify.addHook('afterSanitizeAttributes', (node) => {
  if (node.tagName === 'IFRAME') {
    const src = node.getAttribute('src') ?? '';
    try {
      const url = new URL(src);
      if (url.protocol !== 'https:' || !ALLOWED_IFRAME_HOSTS.has(url.hostname)) {
        node.remove();
        return;
      }
    } catch {
      node.remove();
      return;
    }
    node.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-presentation');
    node.setAttribute('allow', 'autoplay; encrypted-media; picture-in-picture');
  }
  if (node.tagName === 'VIDEO') {
    const src = node.getAttribute('src') ?? '';
    try {
      const url = new URL(src);
      if (url.protocol !== 'https:' && url.protocol !== 'http:') {
        node.remove();
        return;
      }
    } catch {
      node.remove();
      return;
    }
    node.setAttribute('controls', '');
    node.setAttribute('preload', 'metadata');
  }
  if (node.tagName === 'A') {
    node.setAttribute('target', '_blank');
    node.setAttribute('rel', 'noopener noreferrer');
  }
  if (node.hasAttribute('style')) {
    const style = node.getAttribute('style') ?? '';
    const match = style.match(/text-align\s*:\s*(left|center|right|justify)/i);
    if (match) {
      node.setAttribute('style', `text-align: ${match[1]}`);
    } else {
      node.removeAttribute('style');
    }
  }
});

const RICH_SANITIZE_CONFIG = {
  ALLOWED_TAGS: [
    'p',
    'div',
    'br',
    'hr',
    'h1',
    'h2',
    'h3',
    'h4',
    'h5',
    'h6',
    'blockquote',
    'pre',
    'code',
    'ul',
    'ol',
    'li',
    'table',
    'thead',
    'tbody',
    'tr',
    'th',
    'td',
    'a',
    'strong',
    'b',
    'em',
    'i',
    'u',
    's',
    'del',
    'ins',
    'span',
    'mark',
    'sub',
    'sup',
    'small',
    'img',
    'video',
    'iframe',
    'figure',
    'figcaption',
  ],
  ALLOWED_ATTR: [
    'href',
    'target',
    'rel',
    'src',
    'alt',
    'title',
    'width',
    'height',
    'loading',
    'class',
    'start',
    'reversed',
    'type',
    'controls',
    'preload',
    'frameborder',
    'allowfullscreen',
    'allow',
    'sandbox',
    'style',
  ],
  ALLOW_DATA_ATTR: false,
  ADD_ATTR: ['target'],
};

const sanitizeRichHtml = (html: string): string => {
  return infoPagePurify.sanitize(html, RICH_SANITIZE_CONFIG);
};

// Convert content to formatted HTML (handles Telegram HTML + plain text)
const formatContent = (content: string): string => {
  if (!content) return '';

  // Check if content has block-level HTML (full HTML document)
  const hasBlockHtml = /<(p|div|h[1-6]|ul|ol|blockquote)\b/i.test(content);

  if (hasBlockHtml) {
    return sanitizeHtml(content);
  }

  // Content may have inline Telegram HTML (<b>, <i>, <u>, <code>, <a>) but uses
  // newlines for structure. Convert newlines to paragraphs while preserving inline tags.
  const result = content
    .split(/\n\n+/)
    .map((paragraph) => {
      const trimmed = paragraph.trim();
      if (!trimmed) return '';

      // Check if it's a markdown header
      if (/^#{1,4}\s/.test(trimmed)) {
        const level = trimmed.match(/^(#{1,4})/)?.[1].length || 1;
        const text = trimmed.replace(/^#{1,4}\s*/, '');
        return `<h${level}>${text}</h${level}>`;
      }

      // Check for list items
      if (/^[-•]\s/.test(trimmed) || /^\d+[.)]\s/.test(trimmed)) {
        const lines = trimmed.split('\n');
        const isOrdered = /^\d+[.)]\s/.test(lines[0]);
        const startNum = isOrdered ? parseInt(lines[0].match(/^(\d+)/)?.[1] || '1', 10) : 1;
        const listItems = lines
          .map((line) => line.replace(/^[-•]\s*/, '').replace(/^\d+[.)]\s*/, ''))
          .filter((line) => line.trim())
          .map((line) => `<li>${line}</li>`)
          .join('');
        return isOrdered ? `<ol start="${startNum}">${listItems}</ol>` : `<ul>${listItems}</ul>`;
      }

      // Regular paragraph — single newlines become <br/>
      const formatted = trimmed.split('\n').join('<br/>');
      return `<p>${formatted}</p>`;
    })
    .filter(Boolean)
    .join('');

  return sanitizeHtml(result);
};

// --- FAQ accordion item (prototype-styled, smooth measured-height animation) ---

function AccordionItem({
  question,
  answerHtml,
  isOpen,
  onToggle,
}: {
  question: string;
  answerHtml: string;
  isOpen: boolean;
  onToggle: () => void;
}) {
  const contentRef = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState(0);

  useEffect(() => {
    if (contentRef.current) {
      setHeight(isOpen ? contentRef.current.scrollHeight : 0);
    }
  }, [isOpen, answerHtml]);

  useEffect(() => {
    if (!isOpen || !contentRef.current) return;
    const observer = new ResizeObserver(() => {
      if (contentRef.current) setHeight(contentRef.current.scrollHeight);
    });
    observer.observe(contentRef.current);
    return () => observer.disconnect();
  }, [isOpen]);

  return (
    <div className={cn('faq', isOpen && 'open')}>
      <button type="button" onClick={onToggle} className="faq-q" aria-expanded={isOpen}>
        <span>{question}</span>
        <span className="chev">
          <ChevronIcon expanded={isOpen} />
        </span>
      </button>
      <div className="faq-a" style={{ height }}>
        <div ref={contentRef} className="inner" dangerouslySetInnerHTML={{ __html: answerHtml }} />
      </div>
    </div>
  );
}

function ReplacementFaqView({ items }: { items: FaqItem[] }) {
  const [openKey, setOpenKey] = useState<string | null>(null);

  const handleToggle = useCallback((key: string) => {
    setOpenKey((prev) => (prev === key ? null : key));
  }, []);

  return (
    <div className="faq-list">
      {items.map((item, index) => {
        const key = `${index}-${item.q.slice(0, 50)}`;
        return (
          <AccordionItem
            key={key}
            question={item.q}
            answerHtml={sanitizeRichHtml(item.a)}
            isOpen={openKey === key}
            onToggle={() => handleToggle(key)}
          />
        );
      })}
    </div>
  );
}

export default function Info() {
  const { t, i18n } = useTranslation();
  const [activeTab, setActiveTab] = useState<string>('faq');
  const [expandedFaq, setExpandedFaq] = useState<number | null>(null);
  const locale = i18n.language.split('-')[0];

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

  // Fetch tab replacements
  const { data: tabReplacements, isError: replacementsError } = useQuery({
    queryKey: ['info-pages', 'tab-replacements'],
    queryFn: infoPagesApi.getTabReplacements,
    staleTime: 60_000,
  });

  // Fetch custom InfoPages (active pages without replaces_tab — shown as extra tabs)
  const { data: customPages } = useQuery({
    queryKey: ['info-pages', 'list'],
    queryFn: () => infoPagesApi.getPages(),
    staleTime: 60_000,
  });

  const { data: visibility } = useQuery({
    queryKey: ['info-visibility'],
    queryFn: infoApi.getVisibility,
    staleTime: 60_000,
  });

  // Filter to only pages that don't replace a built-in tab and don't collide with built-in IDs
  const extraPages = useMemo(
    () => (customPages ?? []).filter((p) => !p.replaces_tab && !BUILTIN_TABS.has(p.slug)),
    [customPages],
  );

  // Determine if we're on a built-in tab or a custom page tab
  const isCustomTab = !BUILTIN_TABS.has(activeTab);
  const customTabSlug = isCustomTab ? activeTab : null;

  // Check if current built-in tab has a replacement
  const currentTabSlug =
    !isCustomTab && activeTab !== 'loyalty'
      ? (tabReplacements?.[activeTab as ReplacesTab] ?? null)
      : null;

  // Slug to fetch: either a custom page tab or a tab replacement
  const pageSlugToFetch = customTabSlug ?? currentTabSlug;

  // Wait for tab replacements before firing built-in queries (also proceed on error — graceful degradation)
  const replacementsLoaded = tabReplacements !== undefined || replacementsError;

  // Fetch the InfoPage when needed (replacement or custom tab)
  const { data: infoPage, isLoading: infoPageLoading } = useQuery({
    queryKey: ['info-pages', 'page', pageSlugToFetch],
    queryFn: () => {
      if (!pageSlugToFetch) throw new Error('No slug');
      return infoPagesApi.getPageBySlug(pageSlugToFetch);
    },
    enabled: !!pageSlugToFetch,
    staleTime: 60_000,
  });

  // Parse FAQ items from InfoPage content
  const infoPageFaqItems = useMemo((): FaqItem[] => {
    if (!infoPage || infoPage.page_type !== 'faq') return [];
    const raw =
      infoPage.content[locale] || infoPage.content['ru'] || infoPage.content['en'] || '[]';
    try {
      const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }, [infoPage, locale]);

  // Sanitize regular InfoPage HTML content
  const infoPageHtml = useMemo(() => {
    if (!infoPage || infoPage.page_type === 'faq') return '';
    const rawContent =
      infoPage.content[locale] || infoPage.content['ru'] || infoPage.content['en'] || '';
    return sanitizeRichHtml(rawContent);
  }, [infoPage, locale]);

  const { data: faqPages, isLoading: faqLoading } = useQuery({
    queryKey: ['faq-pages'],
    queryFn: infoApi.getFaqPages,
    enabled: activeTab === 'faq' && !currentTabSlug && replacementsLoaded,
    staleTime: 0,
    refetchOnMount: 'always',
  });

  const { data: rules, isLoading: rulesLoading } = useQuery({
    queryKey: ['rules'],
    queryFn: infoApi.getRules,
    enabled: activeTab === 'rules' && !currentTabSlug && replacementsLoaded,
    staleTime: 0,
    refetchOnMount: 'always',
  });

  const { data: privacy, isLoading: privacyLoading } = useQuery({
    queryKey: ['privacy-policy'],
    queryFn: infoApi.getPrivacyPolicy,
    enabled: activeTab === 'privacy' && !currentTabSlug && replacementsLoaded,
    staleTime: 0,
    refetchOnMount: 'always',
  });

  const { data: offer, isLoading: offerLoading } = useQuery({
    queryKey: ['public-offer'],
    queryFn: infoApi.getPublicOffer,
    enabled: activeTab === 'offer' && !currentTabSlug && replacementsLoaded,
    staleTime: 0,
    refetchOnMount: 'always',
  });

  const { data: loyaltyData, isLoading: loyaltyLoading } = useQuery({
    queryKey: ['loyalty-tiers'],
    queryFn: promoApi.getLoyaltyTiers,
    enabled: activeTab === 'loyalty',
    staleTime: 0,
    refetchOnMount: 'always',
  });

  const tabs = useMemo(() => {
    const builtinTabs: Array<{ id: string; label: string; icon: React.FC; emoji?: string }> = [
      { id: 'faq', label: t('info.faq'), icon: QuestionIcon },
      { id: 'rules', label: t('info.rules'), icon: DocumentIcon },
      { id: 'privacy', label: t('info.privacy'), icon: ShieldIcon },
      { id: 'offer', label: t('info.offer'), icon: DocumentIcon },
      { id: 'loyalty', label: t('info.loyalty'), icon: StarIcon },
    ];

    const visibleBuiltinTabs = builtinTabs.filter((tab) => {
      if (tab.id === 'loyalty') return true;
      if (tabReplacements?.[tab.id as ReplacesTab]) return true;
      if (!visibility) return true;
      return visibility[tab.id as keyof InfoVisibility];
    });

    const customTabs = extraPages.map((p) => {
      const label = p.title[locale] || p.title['ru'] || p.title['en'] || p.slug;
      return { id: p.slug, label, icon: DocumentIcon, emoji: p.icon ?? undefined };
    });

    return [...visibleBuiltinTabs, ...customTabs];
  }, [visibility, tabReplacements, extraPages, locale, t]);

  useEffect(() => {
    if (tabs.length === 0) return;
    if (!tabs.some((tab) => tab.id === activeTab)) {
      setActiveTab(tabs[0].id);
    }
  }, [tabs, activeTab]);

  const toggleFaq = useCallback((id: number) => {
    setExpandedFaq((prev) => (prev === id ? null : id));
  }, []);

  const renderInfoPageContent = () => {
    if (infoPageLoading) {
      return <Spinner />;
    }

    if (!infoPage) {
      return <div className="empty">{t('info.noContent')}</div>;
    }

    if (infoPage.page_type === 'faq') {
      if (infoPageFaqItems.length === 0) {
        return <div className="empty">{t('info.noFaq')}</div>;
      }
      return <ReplacementFaqView items={infoPageFaqItems} />;
    }

    if (!infoPageHtml) {
      return <div className="empty">{t('info.noContent')}</div>;
    }

    return (
      <div className="doc">
        <div className="doc-body" dangerouslySetInnerHTML={{ __html: infoPageHtml }} />
      </div>
    );
  };

  const renderContent = () => {
    // Custom page tab — always render InfoPage content
    if (isCustomTab) {
      return renderInfoPageContent();
    }

    // Show spinner while tab replacements are loading (prevents flash of wrong content)
    if (!replacementsLoaded) {
      return <Spinner />;
    }

    // Built-in tab replaced by an InfoPage
    if (currentTabSlug) {
      return renderInfoPageContent();
    }

    if (activeTab === 'faq') {
      if (faqLoading) {
        return <Spinner />;
      }

      if (!faqPages || faqPages.length === 0) {
        return <div className="empty">{t('info.noFaq')}</div>;
      }

      return (
        <div className="faq-list">
          {faqPages.map((faq: FaqPage) => (
            <AccordionItem
              key={faq.id}
              question={faq.title}
              answerHtml={formatContent(faq.content)}
              isOpen={expandedFaq === faq.id}
              onToggle={() => toggleFaq(faq.id)}
            />
          ))}
        </div>
      );
    }

    if (activeTab === 'rules') {
      if (rulesLoading) {
        return <Spinner />;
      }

      if (!rules?.content) {
        return <div className="empty">{t('info.noContent')}</div>;
      }

      return (
        <div className="doc">
          <div
            className="doc-body"
            dangerouslySetInnerHTML={{ __html: formatContent(rules.content) }}
          />
          {rules.updated_at && (
            <p className="doc-meta">
              {t('info.updatedAt')}: {new Date(rules.updated_at).toLocaleDateString()}
            </p>
          )}
        </div>
      );
    }

    if (activeTab === 'privacy') {
      if (privacyLoading) {
        return <Spinner />;
      }

      if (!privacy?.content) {
        return <div className="empty">{t('info.noContent')}</div>;
      }

      return (
        <div className="doc">
          <div
            className="doc-body"
            dangerouslySetInnerHTML={{ __html: formatContent(privacy.content) }}
          />
          {privacy.updated_at && (
            <p className="doc-meta">
              {t('info.updatedAt')}: {new Date(privacy.updated_at).toLocaleDateString()}
            </p>
          )}
        </div>
      );
    }

    if (activeTab === 'offer') {
      if (offerLoading) {
        return <Spinner />;
      }

      if (!offer?.content) {
        return <div className="empty">{t('info.noContent')}</div>;
      }

      return (
        <div className="doc">
          <div
            className="doc-body"
            dangerouslySetInnerHTML={{ __html: formatContent(offer.content) }}
          />
          {offer.updated_at && (
            <p className="doc-meta">
              {t('info.updatedAt')}: {new Date(offer.updated_at).toLocaleDateString()}
            </p>
          )}
        </div>
      );
    }

    if (activeTab === 'loyalty') {
      if (loyaltyLoading) {
        return <Spinner />;
      }

      if (!loyaltyData || loyaltyData.tiers.length === 0) {
        return <div className="empty">{t('info.noLoyaltyTiers')}</div>;
      }

      const formatCurrency = (amount: number) => {
        return new Intl.NumberFormat('ru-RU', {
          style: 'currency',
          currency: 'RUB',
          minimumFractionDigits: 0,
          maximumFractionDigits: 0,
        }).format(amount);
      };

      const tierClass = (tier: LoyaltyTierInfo) =>
        tier.is_current ? 'cur' : tier.is_achieved ? 'done' : 'lock';

      const getStatusBadge = (tier: LoyaltyTierInfo) => {
        if (tier.is_current) {
          return <span className="loy-badge cur">{t('info.statusCurrent')}</span>;
        }
        if (tier.is_achieved) {
          return <span className="loy-badge done">{t('info.statusAchieved')}</span>;
        }
        return <span className="loy-badge lock">{t('info.statusLocked')}</span>;
      };

      const hasAnyDiscount = (tier: LoyaltyTierInfo) => {
        return (
          tier.server_discount_percent > 0 ||
          tier.traffic_discount_percent > 0 ||
          tier.device_discount_percent > 0 ||
          Object.keys(tier.period_discounts).length > 0
        );
      };

      return (
        <div className="loy">
          {/* Progress card */}
          <div className="loy-prog">
            <h3>{t('info.yourProgress')}</h3>

            <div className="loy-stats">
              <div className="loy-stat">
                <div className="k">{t('info.totalSpent')}</div>
                <div className="v">{formatCurrency(loyaltyData.current_spent_rubles)}</div>
              </div>
              <div className="loy-stat">
                <div className="k">{t('info.currentStatus')}</div>
                <div className="v accent">{loyaltyData.current_tier_name || '-'}</div>
              </div>
            </div>

            {/* Progress bar to next tier */}
            {loyaltyData.next_tier_name && loyaltyData.next_tier_threshold_rubles ? (
              <div>
                <div className="loy-next">
                  <span>
                    {t('info.nextStatus')}: {loyaltyData.next_tier_name}
                  </span>
                  <span>
                    {t('info.toNextStatus')}:{' '}
                    {formatCurrency(
                      Math.max(
                        0,
                        loyaltyData.next_tier_threshold_rubles - loyaltyData.current_spent_rubles,
                      ),
                    )}
                  </span>
                </div>
                <div className="loy-bar">
                  <div
                    className="loy-bar-fill"
                    style={{ width: `${Math.min(100, loyaltyData.progress_percent)}%` }}
                  />
                </div>
                <div className="loy-pct">{loyaltyData.progress_percent.toFixed(1)}%</div>
              </div>
            ) : (
              <div className="loy-done">{t('info.allStatusesAchieved')}</div>
            )}
          </div>

          {/* Tiers list */}
          <div className="loy-tiers">
            {loyaltyData.tiers.map((tier) => (
              <div key={tier.id} className={cn('loy-tier', tierClass(tier))}>
                <div className="loy-tier-h">
                  <div className="loy-tier-l">
                    <div className="loy-ic">
                      <StarIcon />
                    </div>
                    <div className="loy-tier-nm">
                      <b>{tier.name}</b>
                      <p>
                        {t('info.threshold')}: {formatCurrency(tier.threshold_rubles)}
                      </p>
                    </div>
                  </div>
                  {getStatusBadge(tier)}
                </div>

                {/* Discounts */}
                {hasAnyDiscount(tier) ? (
                  <div className="loy-disc">
                    <div className="dt">{t('info.discounts')}:</div>
                    <div className="loy-chips">
                      {tier.server_discount_percent > 0 && (
                        <span className="loy-chip">
                          {t('info.serverDiscount')}: -{tier.server_discount_percent}%
                        </span>
                      )}
                      {tier.traffic_discount_percent > 0 && (
                        <span className="loy-chip">
                          {t('info.trafficDiscount')}: -{tier.traffic_discount_percent}%
                        </span>
                      )}
                      {tier.device_discount_percent > 0 && (
                        <span className="loy-chip">
                          {t('info.deviceDiscount')}: -{tier.device_discount_percent}%
                        </span>
                      )}
                      {Object.entries(tier.period_discounts).map(([days, percent]) => (
                        <span key={days} className="loy-chip">
                          {t('info.periodDiscount', { days })}: -{percent}%
                        </span>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className="loy-nodisc">{t('info.noDiscounts')}</div>
                )}
              </div>
            ))}
          </div>
        </div>
      );
    }

    return null;
  };

  return (
    <div className={cn('mitray-info space-y-5', revealed && 'in')}>
      <div className="phead">
        <h1>
          <span className="hi">
            <InfoIcon className="h-[26px] w-[26px]" />
          </span>
          {t('info.title')}
        </h1>
      </div>

      {/* Tabs */}
      <div className="tabs reveal d1">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={cn('tab', activeTab === tab.id && 'on')}
          >
            {tab.emoji ? <span className="emoji">{tab.emoji}</span> : <tab.icon />}
            <span className="lbl">{tab.label}</span>
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="reveal d2">{renderContent()}</div>
    </div>
  );
}
