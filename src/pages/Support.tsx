import { useState, useRef, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { ticketsApi } from '../api/tickets';
import { MessageMediaGrid } from '../components/tickets/MessageMediaGrid';
import { infoApi } from '../api/info';
import { useAuthStore } from '../store/auth';
import { logger } from '../utils/logger';
import { checkRateLimit, getRateLimitResetTime, RATE_LIMIT_KEYS } from '../utils/rateLimit';
import type { TicketDetail } from '../types';
import { ChatIcon, CloseIcon, ImageIcon, PlusIcon, SendIcon } from '@/components/icons';
import { usePlatform } from '@/platform';
import { cn } from '@/lib/utils';
import { linkifyText } from '../utils/linkify';
import '../styles/support.css';

const log = logger.createLogger('Support');

// Media attachment state
interface MediaAttachment {
  id: string;
  file: File;
  preview: string;
  uploading: boolean;
  fileId?: string;
  error?: string;
}

export default function Support() {
  log.debug('Component loaded');

  const { t } = useTranslation();
  const isAdmin = useAuthStore((state) => state.isAdmin);
  const queryClient = useQueryClient();
  const { openTelegramLink, openLink } = usePlatform();
  const [selectedTicket, setSelectedTicket] = useState<TicketDetail | null>(null);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newMessage, setNewMessage] = useState('');
  const [replyMessage, setReplyMessage] = useState('');
  const [rateLimitError, setRateLimitError] = useState<string | null>(null);

  // Media attachment states (multi-upload, up to 10)
  const [createAttachments, setCreateAttachments] = useState<MediaAttachment[]>([]);
  const [replyAttachments, setReplyAttachments] = useState<MediaAttachment[]>([]);
  const createFileInputRef = useRef<HTMLInputElement>(null);
  const replyFileInputRef = useRef<HTMLInputElement>(null);

  const blobUrlsRef = useRef<Set<string>>(new Set());

  // Reveal stagger — add `.in` to the root after first paint (see support.css).
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

  useEffect(() => {
    const urls = blobUrlsRef;
    return () => {
      urls.current.forEach((u) => URL.revokeObjectURL(u));
    };
  }, []);

  const clearCreateAttachments = () => {
    createAttachments.forEach((a) => {
      if (a.preview) URL.revokeObjectURL(a.preview);
    });
    setCreateAttachments([]);
    if (createFileInputRef.current) createFileInputRef.current.value = '';
  };

  const clearReplyAttachments = () => {
    replyAttachments.forEach((a) => {
      if (a.preview) URL.revokeObjectURL(a.preview);
    });
    setReplyAttachments([]);
    if (replyFileInputRef.current) replyFileInputRef.current.value = '';
  };

  // Get support configuration
  const { data: supportConfig, isLoading: configLoading } = useQuery({
    queryKey: ['support-config'],
    queryFn: infoApi.getSupportConfig,
  });

  const { data: tickets, isLoading } = useQuery({
    queryKey: ['tickets'],
    queryFn: () => ticketsApi.getTickets({ per_page: 20 }),
    enabled: supportConfig?.tickets_enabled === true,
  });

  const { data: ticketDetail, isLoading: detailLoading } = useQuery({
    queryKey: ['ticket', selectedTicket?.id],
    queryFn: () => ticketsApi.getTicket(selectedTicket!.id),
    enabled: !!selectedTicket,
  });

  // Handle file selection (multi-upload)
  const handleFileSelect = async (
    file: File,
    setAttachments: React.Dispatch<React.SetStateAction<MediaAttachment[]>>,
  ) => {
    const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
    if (!allowedTypes.includes(file.type)) return;
    if (file.size > 10 * 1024 * 1024) return;

    const preview = URL.createObjectURL(file);
    blobUrlsRef.current.add(preview);
    const id =
      typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : `att_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const entry: MediaAttachment = { id, file, preview, uploading: true };
    setAttachments((prev) => (prev.length >= 10 ? prev : [...prev, entry]));

    try {
      const result = await ticketsApi.uploadMedia(file, 'photo');
      setAttachments((prev) =>
        prev.map((a) => (a.id === id ? { ...a, uploading: false, fileId: result.file_id } : a)),
      );
    } catch {
      setAttachments((prev) =>
        prev.map((a) =>
          a.id === id ? { ...a, uploading: false, error: t('support.uploadFailed') } : a,
        ),
      );
    }
  };

  const createMutation = useMutation({
    mutationFn: async () => {
      const ready = createAttachments.filter((a) => a.fileId) as Array<{ fileId: string }>;
      const media =
        ready.length > 0
          ? {
              media_type: 'photo',
              media_file_id: ready[0].fileId,
              media_items: ready.map((a) => ({ type: 'photo' as const, file_id: a.fileId })),
            }
          : undefined;
      return ticketsApi.createTicket(newTitle, newMessage, media);
    },
    onSuccess: (ticket) => {
      queryClient.invalidateQueries({ queryKey: ['tickets'] });
      setShowCreateForm(false);
      setNewTitle('');
      setNewMessage('');
      clearCreateAttachments();
      setSelectedTicket(ticket);
    },
  });

  const replyMutation = useMutation({
    mutationFn: async () => {
      const ready = replyAttachments.filter((a) => a.fileId) as Array<{ fileId: string }>;
      const media =
        ready.length > 0
          ? {
              media_type: 'photo',
              media_file_id: ready[0].fileId,
              media_items: ready.map((a) => ({ type: 'photo' as const, file_id: a.fileId })),
            }
          : undefined;
      await ticketsApi.addMessage(selectedTicket!.id, replyMessage, media);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ticket', selectedTicket?.id] });
      setReplyMessage('');
      clearReplyAttachments();
    },
  });

  // Status → pill class (prototype .tst variants) + label.
  const tstClass = (status: string) => {
    switch (status) {
      case 'answered':
        return 'open'; // green — support replied
      case 'open':
        return 'info'; // accent — awaiting support
      case 'pending':
        return 'wait'; // warn — awaiting user
      case 'closed':
      default:
        return 'closed'; // neutral
    }
  };
  const getStatusLabel = (status: string) => t(`support.status.${status}`) || status;

  // Show loading while checking configuration
  if (configLoading) {
    return (
      <div className="mitray-sup">
        <div className="sup-loader">
          <span className="sup-spin" />
        </div>
      </div>
    );
  }

  // If tickets are disabled, show redirect message
  if (supportConfig && !supportConfig.tickets_enabled) {
    log.debug('Tickets disabled, config:', supportConfig);

    const getSupportMessage = () => {
      if (supportConfig.support_type === 'profile') {
        const supportUsername = supportConfig.support_username || '@support';
        return {
          title: isAdmin ? t('support.ticketsDisabled') : t('support.title'),
          message: t('support.contactSupport', { username: supportUsername }),
          buttonText: t('support.contactUs'),
          buttonAction: () => {
            const username = supportUsername.startsWith('@')
              ? supportUsername.slice(1)
              : supportUsername;
            openTelegramLink(`https://t.me/${username}`);
          },
        };
      }

      if (supportConfig.support_type === 'url' && supportConfig.support_url) {
        return {
          title: isAdmin ? t('support.ticketsDisabled') : t('support.title'),
          message: t('support.useExternalLink'),
          buttonText: t('support.openSupport'),
          buttonAction: () => {
            openLink(supportConfig.support_url!, { tryInstantView: false });
          },
        };
      }

      // Fallback: contact support (should not normally happen if config is correct)
      const supportUsername = supportConfig.support_username || '@support';
      return {
        title: isAdmin ? t('support.ticketsDisabled') : t('support.title'),
        message: t('support.contactSupport', { username: supportUsername }),
        buttonText: t('support.contactUs'),
        buttonAction: () => {
          const username = supportUsername.startsWith('@')
            ? supportUsername.slice(1)
            : supportUsername;
          openTelegramLink(`https://t.me/${username}`);
        },
      };
    };

    const supportMessage = getSupportMessage();

    return (
      <div className={cn('mitray-sup', revealed && 'in')}>
        <div className="card redirect reveal d1">
          <div className="ri">
            <ChatIcon className="h-8 w-8" />
          </div>
          <h2>{supportMessage.title}</h2>
          <p>{supportMessage.message}</p>
          <button className="btn-primary" onClick={supportMessage.buttonAction}>
            {supportMessage.buttonText}
          </button>
        </div>
      </div>
    );
  }

  // Attachments preview
  const AttachmentsPreview = ({
    items,
    onRemove,
  }: {
    items: MediaAttachment[];
    onRemove: (idx: number) => void;
  }) =>
    items.length === 0 ? null : (
      <div className="sup-atts">
        {items.map((att, idx) => (
          <div key={idx} className="sup-att">
            {att.preview ? (
              <img src={att.preview} alt="" loading="lazy" />
            ) : (
              <div className="att-fallback">{att.file.name.slice(-6)}</div>
            )}
            {att.uploading && (
              <div className="att-ov">
                <span className="att-spin" />
              </div>
            )}
            {att.error && <div className="att-ov err">!</div>}
            <button type="button" className="att-x" onClick={() => onRemove(idx)}>
              <CloseIcon className="h-3 w-3" />
            </button>
          </div>
        ))}
      </div>
    );

  const openCreateForm = () => {
    setShowCreateForm(true);
    setSelectedTicket(null);
    setRateLimitError(null);
    clearCreateAttachments();
  };

  // Mobile: the thread is a full-screen sliding panel; back button closes it.
  const closeThread = () => {
    setShowCreateForm(false);
    setSelectedTicket(null);
    setRateLimitError(null);
    clearReplyAttachments();
  };
  const threadOpen = showCreateForm || !!selectedTicket;

  const contactUsername = supportConfig?.support_username;

  return (
    <div className={cn('mitray-sup', revealed && 'in')}>
      {/* Head */}
      <div className="phead reveal d1">
        <h1>
          <span className="hi">
            <ChatIcon className="h-6 w-6" />
          </span>
          {t('support.title')}
        </h1>
        <button className="btn-primary" onClick={openCreateForm}>
          <PlusIcon className="h-[18px] w-[18px]" />
          {t('support.newTicket')}
        </button>
      </div>

      {/* Contact banner (support_type === 'both') */}
      {supportConfig?.support_type === 'both' && contactUsername && (
        <div className="card contact reveal d2">
          <span className="ci">
            <ChatIcon className="h-[22px] w-[22px]" />
          </span>
          <div className="ct">
            <b>{t('support.contactUs')}</b>
            <p>{contactUsername}</p>
          </div>
          <button
            className="btn-ghost"
            onClick={() => {
              const username = contactUsername.startsWith('@')
                ? contactUsername.slice(1)
                : contactUsername;
              openTelegramLink(`https://t.me/${username}`);
            }}
          >
            {t('support.writeButton', 'Написать')}
          </button>
        </div>
      )}

      <div className="sup-grid">
        {/* Tickets list */}
        <div className="card reveal d2">
          <div className="card-h">
            <div className="t">{t('support.yourTickets')}</div>
          </div>

          {isLoading ? (
            <div className="sup-loader">
              <span className="sup-spin" />
            </div>
          ) : tickets?.items && tickets.items.length > 0 ? (
            <div className="tickets">
              {tickets.items.map((ticket) => (
                <button
                  key={ticket.id}
                  className={cn('ticket', selectedTicket?.id === ticket.id && 'on')}
                  onClick={() => {
                    setSelectedTicket(ticket as unknown as TicketDetail);
                    setShowCreateForm(false);
                    setRateLimitError(null);
                    clearReplyAttachments();
                  }}
                >
                  <div className="tr">
                    <b>{ticket.title}</b>
                    <span className={cn('tst', tstClass(ticket.status))}>
                      {getStatusLabel(ticket.status)}
                    </span>
                  </div>
                  <div className="date">{new Date(ticket.updated_at).toLocaleDateString()}</div>
                </button>
              ))}
            </div>
          ) : (
            <div className="tickets-empty">
              <span className="te-ic">
                <ChatIcon className="h-7 w-7" />
              </span>
              <span>{t('support.noTickets')}</span>
            </div>
          )}
        </div>

        {/* Thread / create */}
        <div className={cn('card thread reveal d3', threadOpen && 'open')}>
          {showCreateForm ? (
            <div className="thread-view">
              <div className="thread-h">
                <button
                  type="button"
                  className="th-back"
                  onClick={closeThread}
                  aria-label={t('common.back', 'Назад')}
                >
                  <svg
                    width="20"
                    height="20"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M15 18l-6-6 6-6" />
                  </svg>
                </button>
                <b>{t('support.createTicket')}</b>
              </div>
              <form
                className="sup-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  setRateLimitError(null);
                  // Rate limit: max 3 tickets per 60 seconds
                  if (!checkRateLimit(RATE_LIMIT_KEYS.TICKET_CREATE, 3, 60000)) {
                    const resetTime = getRateLimitResetTime(RATE_LIMIT_KEYS.TICKET_CREATE);
                    setRateLimitError(t('support.tooManyRequests', { seconds: resetTime }));
                    return;
                  }
                  createMutation.mutate();
                }}
              >
                <div className="field">
                  <label htmlFor="support-subject" className="lab">
                    {t('support.subject')}
                  </label>
                  <input
                    id="support-subject"
                    type="text"
                    className="inp"
                    placeholder={t('support.subjectPlaceholder')}
                    value={newTitle}
                    onChange={(e) => setNewTitle(e.target.value)}
                    required
                    minLength={3}
                    maxLength={255}
                  />
                </div>
                <div className="field">
                  <label htmlFor="support-message" className="lab">
                    {t('support.message')}
                  </label>
                  <textarea
                    id="support-message"
                    className="inp"
                    placeholder={t('support.messagePlaceholder')}
                    value={newMessage}
                    onChange={(e) => setNewMessage(e.target.value)}
                    required
                    minLength={10}
                    maxLength={4000}
                  />
                </div>

                {/* Image attachments */}
                <div>
                  <input
                    ref={createFileInputRef}
                    type="file"
                    accept="image/jpeg,image/png,image/gif,image/webp"
                    multiple
                    className="hidden"
                    onChange={(e) => {
                      const files = Array.from(e.target.files || []);
                      files.forEach((file) => handleFileSelect(file, setCreateAttachments));
                      e.target.value = '';
                    }}
                  />
                  {createAttachments.length > 0 && (
                    <div style={{ marginBottom: 10 }}>
                      <AttachmentsPreview
                        items={createAttachments}
                        onRemove={(idx) =>
                          setCreateAttachments((prev) => {
                            const removed = prev[idx];
                            if (removed?.preview) URL.revokeObjectURL(removed.preview);
                            return prev.filter((_, i) => i !== idx);
                          })
                        }
                      />
                    </div>
                  )}
                  {createAttachments.length < 10 && (
                    <button
                      type="button"
                      className="attach-btn"
                      onClick={() => createFileInputRef.current?.click()}
                      disabled={createAttachments.some((a) => a.uploading)}
                    >
                      <ImageIcon className="h-4 w-4" />
                      {t('support.attachImage')}{' '}
                      {createAttachments.length > 0 && `(${createAttachments.length}/10)`}
                    </button>
                  )}
                </div>

                {rateLimitError && <div className="sup-err">{rateLimitError}</div>}

                <div className="form-actions">
                  <button
                    type="submit"
                    className="btn-primary"
                    disabled={
                      createMutation.isPending || createAttachments.some((a) => a.uploading)
                    }
                  >
                    {createMutation.isPending ? (
                      <span className="att-spin" />
                    ) : (
                      <SendIcon className="h-4 w-4" />
                    )}
                    {t('support.send')}
                  </button>
                  <button
                    type="button"
                    className="btn-ghost"
                    onClick={() => {
                      setShowCreateForm(false);
                      clearCreateAttachments();
                    }}
                  >
                    {t('common.cancel')}
                  </button>
                </div>
              </form>
            </div>
          ) : selectedTicket ? (
            <div className="thread-view">
              <div className="thread-h">
                <button
                  type="button"
                  className="th-back"
                  onClick={closeThread}
                  aria-label={t('common.back', 'Назад')}
                >
                  <svg
                    width="20"
                    height="20"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M15 18l-6-6 6-6" />
                  </svg>
                </button>
                <b>{ticketDetail?.title || selectedTicket.title}</b>
                <span
                  className={cn('tst', tstClass(ticketDetail?.status || selectedTicket.status))}
                >
                  {getStatusLabel(ticketDetail?.status || selectedTicket.status)}
                </span>
              </div>

              {detailLoading ? (
                <div className="sup-loader">
                  <span className="sup-spin" />
                </div>
              ) : ticketDetail?.messages ? (
                <div className="msgs">
                  {ticketDetail.messages.map((msg) => (
                    <div key={msg.id} className={cn('msg', msg.is_from_admin ? 'them' : 'me')}>
                      {msg.message_text && (
                        <div
                          className="msg-txt"
                          dangerouslySetInnerHTML={{ __html: linkifyText(msg.message_text) }}
                        />
                      )}
                      <MessageMediaGrid
                        message={msg}
                        translateError={t('support.imageLoadFailed')}
                      />
                      <span className="mt">{new Date(msg.created_at).toLocaleString()}</span>
                    </div>
                  ))}
                </div>
              ) : null}

              {/* Reply / closed hint */}
              {ticketDetail?.status === 'closed' ? (
                <div className="closed-hint">
                  {t(
                    'support.ticketClosedHint',
                    'Обращение закрыто. Создайте новый тикет, если нужна помощь.',
                  )}
                </div>
              ) : ticketDetail?.is_reply_blocked ? (
                <div className="closed-hint">{t('support.repliesDisabled')}</div>
              ) : (
                <form
                  className="reply-form"
                  onSubmit={(e) => {
                    e.preventDefault();
                    setRateLimitError(null);
                    // Rate limit: max 5 replies per 30 seconds
                    if (!checkRateLimit(RATE_LIMIT_KEYS.TICKET_REPLY, 5, 30000)) {
                      const resetTime = getRateLimitResetTime(RATE_LIMIT_KEYS.TICKET_REPLY);
                      setRateLimitError(t('support.tooManyRequests', { seconds: resetTime }));
                      return;
                    }
                    replyMutation.mutate();
                  }}
                >
                  <div className="reply">
                    <textarea
                      className="reply-in"
                      rows={1}
                      placeholder={t('support.replyPlaceholder')}
                      value={replyMessage}
                      onChange={(e) => setReplyMessage(e.target.value)}
                      maxLength={4000}
                    />
                    <button
                      type="submit"
                      className="send"
                      disabled={
                        (!replyMessage.trim() &&
                          replyAttachments.filter((a) => a.fileId).length === 0) ||
                        replyMutation.isPending ||
                        replyAttachments.some((a) => a.uploading)
                      }
                    >
                      {replyMutation.isPending ? (
                        <span className="att-spin" />
                      ) : (
                        <SendIcon className="h-[18px] w-[18px]" />
                      )}
                    </button>
                  </div>

                  <input
                    ref={replyFileInputRef}
                    type="file"
                    accept="image/jpeg,image/png,image/gif,image/webp"
                    multiple
                    className="hidden"
                    onChange={(e) => {
                      const files = Array.from(e.target.files || []);
                      files.forEach((file) => handleFileSelect(file, setReplyAttachments));
                      e.target.value = '';
                    }}
                  />
                  {replyAttachments.length > 0 && (
                    <div style={{ marginTop: 10 }}>
                      <AttachmentsPreview
                        items={replyAttachments}
                        onRemove={(idx) =>
                          setReplyAttachments((prev) => {
                            const removed = prev[idx];
                            if (removed?.preview) URL.revokeObjectURL(removed.preview);
                            return prev.filter((_, i) => i !== idx);
                          })
                        }
                      />
                    </div>
                  )}
                  {replyAttachments.length < 10 && (
                    <div style={{ marginTop: 10 }}>
                      <button
                        type="button"
                        className="attach-btn"
                        onClick={() => replyFileInputRef.current?.click()}
                        disabled={replyAttachments.some((a) => a.uploading)}
                      >
                        <ImageIcon className="h-4 w-4" />
                        {t('support.attachImage')}{' '}
                        {replyAttachments.length > 0 && `(${replyAttachments.length}/10)`}
                      </button>
                    </div>
                  )}
                  {rateLimitError && (
                    <div className="sup-err" style={{ marginTop: 10 }}>
                      {rateLimitError}
                    </div>
                  )}
                </form>
              )}
            </div>
          ) : (
            <div className="thread-empty">
              <span className="te-ic">
                <ChatIcon className="h-[30px] w-[30px]" />
              </span>
              <span>{t('support.selectTicket')}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
