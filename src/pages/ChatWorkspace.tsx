import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { Link, useLocation, useSearchParams } from "react-router-dom";
import type { Session } from "@supabase/supabase-js";
import type { Database } from "../lib/database.types";
import { supabase } from "../lib/supabase";
import "./ChatWorkspace.css";

type Conversation = Database["public"]["Tables"]["chat_conversations"]["Row"];
type ChatMessage = Database["public"]["Tables"]["chat_messages"]["Row"];
type ChatProduct = Pick<
  Database["public"]["Tables"]["products"]["Row"],
  "id" | "slug" | "name" | "image_url" | "status"
>;
type InboxFilter = "all" | "unread" | "read" | "resolved";

function messageDate(value: string) {
  return new Date(value).toLocaleString("en-NP", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function chatErrorMessage(cause: unknown, fallback: string) {
  if (typeof cause === "object" && cause !== null) {
    const code = "code" in cause && typeof cause.code === "string" ? cause.code : "";
    const message = "message" in cause && typeof cause.message === "string" ? cause.message : "";
    if (code === "PGRST205" && message.includes("chat_")) {
      return "Customer messaging tables are not available through the Supabase API. Verify the existing tables are exposed and reload the PostgREST schema cache if needed; do not rerun the table-creating migration.";
    }
    if (cause instanceof Error) return cause.message;
    if (message) return message;
  }
  return fallback;
}

function orderedMessages(messages: ChatMessage[]) {
  return [...messages].sort((first, second) =>
    first.created_at.localeCompare(second.created_at) || first.id.localeCompare(second.id));
}

export default function ChatWorkspace({ admin = false }: { admin?: boolean }) {
  const [searchParams] = useSearchParams();
  const location = useLocation();
  const requestedProductId = searchParams.get("product");
  const [session, setSession] = useState<Session | null>(null);
  const [authLoading, setAuthLoading] = useState(Boolean(supabase));
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [productDetails, setProductDetails] = useState<Record<string, ChatProduct>>({});
  const [unreadCounts, setUnreadCounts] = useState<Record<string, number>>({});
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [loadingConversations, setLoadingConversations] = useState(Boolean(supabase));
  const [conversationLoadFailed, setConversationLoadFailed] = useState(false);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [messageLoadFailed, setMessageLoadFailed] = useState(false);
  const [startConversationFailed, setStartConversationFailed] = useState(false);
  const [startRetry, setStartRetry] = useState(0);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState<InboxFilter>("all");
  const [query, setQuery] = useState("");
  const [desktopAlerts, setDesktopAlerts] = useState(
    typeof Notification !== "undefined" && Notification.permission === "granted",
  );
  const [newMessageNotice, setNewMessageNotice] = useState<Conversation | null>(null);
  const tailRef = useRef<HTMLDivElement>(null);
  const selectedRef = useRef<string | null>(null);
  const conversationsRef = useRef<Conversation[]>([]);
  const productDetailsRef = useRef<Record<string, ChatProduct>>({});
  const requestedProductHandled = useRef<string | null>(null);
  const pendingMessageId = useRef<string | null>(null);
  const sendingRef = useRef(false);
  const activeConversation = conversations.find(({ id }) => id === selectedId) ?? null;
  const activeProduct = activeConversation ? productDetails[activeConversation.product_id] : null;
  const currentUserId = session?.user.id;

  const loadConversations = useCallback(async () => {
    if (!supabase || !currentUserId) return;
    let conversationsQuery = supabase.from("chat_conversations").select("*");
    if (!admin) conversationsQuery = conversationsQuery.eq("customer_id", currentUserId);
    const [{ data: conversationRows, error: conversationError }, { data: unreadRows, error: unreadError }] =
      await Promise.all([
        conversationsQuery.order("last_message_at", { ascending: false }).order("id", { ascending: false }),
        supabase.from("chat_messages").select("conversation_id")
          .eq("sender_role", admin ? "customer" : "admin").is("read_at", null),
      ]);
    if (conversationError) throw conversationError;
    if (unreadError) throw unreadError;
    const productIds = [...new Set(conversationRows.map(({ product_id }) => product_id))];
    const { data: productRows, error: productError } = productIds.length
      ? await supabase.from("products").select("id,slug,name,image_url,status").in("id", productIds)
      : { data: [], error: null };
    if (productError) throw productError;
    const counts: Record<string, number> = {};
    for (const row of unreadRows) counts[row.conversation_id] = (counts[row.conversation_id] ?? 0) + 1;
    conversationsRef.current = conversationRows;
    setConversations(conversationRows);
    setProductDetails(Object.fromEntries(productRows.map((product) => [product.id, product])));
    setUnreadCounts(counts);
    setLoadingConversations(false);
    setConversationLoadFailed(false);
    const requestedConversation = requestedProductId
      ? conversationRows.find(({ product_id }) => product_id === requestedProductId)?.id
      : undefined;
    const nextSelectedId = selectedRef.current && conversationRows.some(({ id }) => id === selectedRef.current)
      ? selectedRef.current
      : requestedConversation ?? conversationRows[0]?.id ?? null;
    if (nextSelectedId !== selectedRef.current) {
      setLoadingMessages(Boolean(nextSelectedId));
      setSelectedId(nextSelectedId);
    }
  }, [admin, currentUserId, requestedProductId]);

  const loadMessages = useCallback(async (conversationId: string) => {
    if (!supabase) return;
    const { data, error: messagesError } = await supabase.from("chat_messages").select("*")
      .eq("conversation_id", conversationId)
      .order("created_at", { ascending: true })
      .order("id", { ascending: true });
    if (messagesError) throw messagesError;
    if (selectedRef.current !== conversationId) return;
    setMessages(orderedMessages(data));
    const { error: readError } = await supabase.rpc("mark_chat_messages_read", {
      p_conversation_id: conversationId,
    });
    if (readError) throw readError;
    if (selectedRef.current !== conversationId) return;
    await loadConversations();
  }, [loadConversations]);

  useEffect(() => {
    if (!supabase) {
      return;
    }

    let active = true;
    void supabase.auth.getSession().then(({ data, error: sessionError }) => {
      if (!active) return;
      if (sessionError) setError(sessionError.message);
      setSession(data.session);
      setAuthLoading(false);
    });
    const { data: authListener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      setAuthLoading(false);
      setConversations([]);
      setProductDetails({});
      setMessages([]);
      setSelectedId(null);
      setLoadingMessages(false);
      setLoadingConversations(Boolean(nextSession));
    });
    return () => {
      active = false;
      authListener.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    selectedRef.current = selectedId;
  }, [selectedId]);

  useEffect(() => {
    productDetailsRef.current = productDetails;
  }, [productDetails]);

  useEffect(() => {
    if (!supabase || !currentUserId) {
      return;
    }
    let active = true;
    void (async () => {
      if (admin) {
        const { data: isAdmin, error: roleError } = await supabase.rpc("is_store_admin");
        if (roleError) throw roleError;
        if (!isAdmin) throw new Error("Administrator access is required to view customer conversations.");
      }
      await loadConversations();
    })().catch((cause: unknown) => {
      if (active) {
        setError(chatErrorMessage(cause, "Unable to load conversations."));
        setConversationLoadFailed(true);
        setLoadingConversations(false);
      }
    });
    return () => {
      active = false;
    };
  }, [admin, currentUserId, loadConversations]);

  useEffect(() => {
    if (!supabase || !currentUserId) return;
    const channel = supabase.channel(`chat-inbox-${admin ? "admin" : currentUserId}`)
      .on("postgres_changes", {
        event: "*",
        schema: "public",
        table: "chat_messages",
      }, (payload) => {
        const record = payload.new as Partial<ChatMessage>;
        void loadConversations().then(() => {
          if (admin && payload.eventType === "INSERT" && record.sender_role === "customer" &&
            record.conversation_id !== selectedRef.current) {
            const conversation = conversationsRef.current.find(({ id }) => id === record.conversation_id);
            if (conversation) {
              setNewMessageNotice(conversation);
              if (desktopAlerts && typeof Notification !== "undefined") {
                new Notification("New FORM & FOUND customer message", {
                  body: `Customer ${conversation.customer_id.slice(0, 8)} · ${productDetailsRef.current[conversation.product_id]?.name ?? "Product"}`,
                });
              }
            }
          }
        }).catch((cause: unknown) => {
          setError(chatErrorMessage(cause, "Unable to refresh chat conversations."));
          setConversationLoadFailed(true);
        });
      })
      .subscribe((status) => {
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          setError("Live chat connection interrupted. Reconnecting…");
        } else if (status === "SUBSCRIBED") {
          setError((current) => current === "Live chat connection interrupted. Reconnecting…" ? "" : current);
        }
      });
    return () => {
      void supabase?.removeChannel(channel);
    };
  }, [admin, currentUserId, desktopAlerts, loadConversations]);

  useEffect(() => {
    if (!requestedProductId || !currentUserId || admin || !supabase) return;
    const requestKey = `${currentUserId}:${requestedProductId}`;
    if (requestedProductHandled.current === requestKey) return;
    requestedProductHandled.current = requestKey;
    let active = true;
    void (async () => {
      const { data, error: createError } = await supabase.rpc("open_chat_conversation", {
        p_product_id: requestedProductId,
      });
      if (createError) throw createError;
      if (!active) return;
      setStartConversationFailed(false);
      setLoadingMessages(true);
      setSelectedId(data);
      await loadConversations();
    })().catch((cause: unknown) => {
      if (active) {
        requestedProductHandled.current = null;
        setStartConversationFailed(true);
        setError(chatErrorMessage(cause, "Unable to start a conversation."));
      }
    });
    return () => {
      active = false;
    };
  }, [admin, currentUserId, loadConversations, requestedProductId, startRetry]);

  useEffect(() => {
    if (!selectedId || !currentUserId || !supabase) {
      return;
    }
    let active = true;
    void (async () => {
      const { data, error: messagesError } = await supabase.from("chat_messages").select("*")
        .eq("conversation_id", selectedId)
        .order("created_at", { ascending: true })
        .order("id", { ascending: true });
      if (messagesError) throw messagesError;
      if (!active) return;
      setMessages(orderedMessages(data));
      setMessageLoadFailed(false);
      const { error: readError } = await supabase.rpc("mark_chat_messages_read", {
        p_conversation_id: selectedId,
      });
      if (readError) throw readError;
      await loadConversations();
    })().catch((cause: unknown) => {
      if (active) {
        setMessageLoadFailed(true);
        setError(chatErrorMessage(cause, "Unable to load message history."));
      }
    }).finally(() => {
      if (active) setLoadingMessages(false);
    });
    const channel = supabase.channel(`chat-thread-${selectedId}`)
      .on("postgres_changes", {
        event: "*",
        schema: "public",
        table: "chat_messages",
        filter: `conversation_id=eq.${selectedId}`,
      }, () => {
        void loadMessages(selectedId).catch((cause: unknown) => {
          setError(chatErrorMessage(cause, "Unable to refresh messages."));
        });
      })
      .on("postgres_changes", {
        event: "UPDATE",
        schema: "public",
        table: "chat_conversations",
        filter: `id=eq.${selectedId}`,
      }, () => {
        void loadConversations().catch((cause: unknown) => {
          setError(chatErrorMessage(cause, "Unable to refresh conversation details."));
          setConversationLoadFailed(true);
        });
      })
      .subscribe((status) => {
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          setError("Live chat connection interrupted. Reconnecting…");
        } else if (status === "SUBSCRIBED") {
          setError((current) => current === "Live chat connection interrupted. Reconnecting…" ? "" : current);
        }
      });
    return () => {
      active = false;
      void supabase?.removeChannel(channel);
    };
  }, [currentUserId, loadConversations, loadMessages, selectedId]);

  useEffect(() => {
    tailRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages]);

  const filteredConversations = useMemo(() => conversations.filter((conversation) => {
    const unread = (unreadCounts[conversation.id] ?? 0) > 0;
    const matchesFilter = filter === "all" ||
      (filter === "unread" && unread) ||
      (filter === "read" && conversation.status === "open" && !unread) ||
      (filter === "resolved" && conversation.status === "resolved");
    const product = productDetails[conversation.product_id];
    const searchText = `${conversation.customer_id} ${product?.name ?? ""} ${product?.slug ?? ""}`
      .toLowerCase();
    return matchesFilter && searchText.includes(query.trim().toLowerCase());
  }), [conversations, filter, productDetails, query, unreadCounts]);

  async function sendMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const content = draft.trim();
    if (!content || content.length > 4000 || !activeConversation || !session || !supabase || sendingRef.current) return;
    sendingRef.current = true;
    setSending(true);
    setError("");
    const messageId = pendingMessageId.current ?? crypto.randomUUID();
    pendingMessageId.current = messageId;
    try {
      const { error: sendError } = await supabase.from("chat_messages").insert({
        id: messageId,
        conversation_id: activeConversation.id,
        content,
      });
      if (sendError) {
        const { data: existingMessage, error: existingMessageError } = await supabase.from("chat_messages")
          .select("id, content, sender_id, conversation_id")
          .eq("id", messageId)
          .maybeSingle();
        if (existingMessageError || !existingMessage || existingMessage.content !== content ||
          existingMessage.sender_id !== session.user.id || existingMessage.conversation_id !== activeConversation.id) {
          setError(`Your message could not be sent: ${sendError.message}. You can retry without losing your text.`);
          return;
        }
      }
      pendingMessageId.current = null;
      setDraft("");
      setError("");
      await loadMessages(activeConversation.id);
    } catch (cause: unknown) {
      setError(chatErrorMessage(cause, "Your message could not be sent. You can retry without losing your text."));
    } finally {
      setSending(false);
      sendingRef.current = false;
    }
  }

  async function changeStatus(status: "open" | "resolved") {
    if (!supabase || !activeConversation) return;
    setError("");
    const { error: statusError } = await supabase.rpc("set_chat_conversation_status", {
      p_conversation_id: activeConversation.id,
      p_status: status,
    });
    if (statusError) {
      setError(statusError.message);
      return;
    }
    try {
      await loadConversations();
    } catch (cause: unknown) {
      setError(chatErrorMessage(cause, "Status updated, but the inbox could not refresh."));
      setConversationLoadFailed(true);
    }
  }

  async function enableDesktopAlerts() {
    if (typeof Notification === "undefined") {
      setError("Desktop notifications are not supported in this browser.");
      return;
    }
    try {
      const permission = await Notification.requestPermission();
      setDesktopAlerts(permission === "granted");
      if (permission !== "granted") setError("Desktop notifications were not enabled. New-message counts remain available in the inbox.");
    } catch (cause: unknown) {
      setError(chatErrorMessage(cause, "Unable to request desktop notification permission."));
    }
  }

  function chooseConversation(conversationId: string) {
    if (conversationId !== selectedId) {
      setLoadingMessages(true);
      setMessageLoadFailed(false);
    }
    setSelectedId(conversationId);
    setNewMessageNotice(null);
    setError("");
  }

  async function retryMessages() {
    if (!selectedId) return;
    setLoadingMessages(true);
    setMessageLoadFailed(false);
    setError("");
    try {
      await loadMessages(selectedId);
    } catch (cause: unknown) {
      setMessageLoadFailed(true);
      setError(chatErrorMessage(cause, "Unable to reload message history."));
    } finally {
      setLoadingMessages(false);
    }
  }

  async function retryConversations() {
    setLoadingConversations(true);
    setConversationLoadFailed(false);
    setError("");
    try {
      await loadConversations();
    } catch (cause: unknown) {
      setError(chatErrorMessage(cause, "Unable to refresh conversations."));
      setConversationLoadFailed(true);
    } finally {
      setLoadingConversations(false);
    }
  }

  if (authLoading) {
    return <main className={admin ? "admin-chat-page" : "chat-page"}><p className="chat-state">Checking your account…</p></main>;
  }

  if (!supabase) {
    return (
      <main className={admin ? "admin-chat-page" : "chat-page"}>
        <section className="chat-signin">
          <p className="chat-eyebrow">FORM & FOUND / CUSTOMER CARE</p>
          <h1>Chat is not<br />configured<span>.</span></h1>
          <p>Set the public Supabase URL and anon key, and ensure the existing chat tables and reviewed RPC migration are available to the project.</p>
        </section>
      </main>
    );
  }

  if (!session) {
    const next = `${location.pathname}${location.search}`;
    return (
      <main className={admin ? "admin-chat-page" : "chat-page"}>
        <section className="chat-signin">
          <p className="chat-eyebrow">FORM & FOUND / CUSTOMER CARE</p>
          <h1>We’re here<br />for you<span>.</span></h1>
          <p>Sign in and ask us anything about a product. We’ll keep your conversation right here for whenever you need it.</p>
          <Link className="chat-primary-button" to={`/account?next=${encodeURIComponent(next)}`}>SIGN IN TO MESSAGE US ↗</Link>
        </section>
      </main>
    );
  }

  return (
    <main className={admin ? "admin-chat-page" : "chat-page"}>
      {!admin && (
        <header className="chat-page-heading">
          <div><p className="chat-eyebrow">FORM & FOUND / CUSTOMER CARE</p><h1>LET’S TALK<span>.</span></h1></div>
          <p>Need a hand choosing a piece, or have a question about an order? Leave us a note and we’ll get back to you here.</p>
        </header>
      )}
      {admin && (
        <header className="chat-admin-heading">
          <div><p className="chat-eyebrow">CUSTOMER CARE / LIVE INBOX</p><h1>CUSTOMER CHATS<span>.</span></h1></div>
          <p>Questions from customers, kept with their product and account details.</p>
        </header>
      )}
      {error && <p className="chat-error" role="alert">{error}</p>}
      {startConversationFailed && <button className="chat-retry-button" type="button" onClick={() => {
        requestedProductHandled.current = null;
        setStartConversationFailed(false);
        setStartRetry((attempt) => attempt + 1);
      }}>RETRY STARTING CONVERSATION</button>}
      {admin && newMessageNotice && (
        <button className="chat-toast" type="button" onClick={() => chooseConversation(newMessageNotice.id)}>
          New message from customer {newMessageNotice.customer_id.slice(0, 8)} about {productDetails[newMessageNotice.product_id]?.name ?? "a product"} · View
        </button>
      )}
      <div className={`chat-workspace${admin ? " is-admin" : ""}`}>
        <aside className={`chat-list${selectedId ? " has-selection" : ""}`}>
          <div className="chat-list-heading">
            <div><span>{admin ? "CUSTOMER INBOX" : "MESSAGE HISTORY"}</span><strong>{admin
              ? Object.values(unreadCounts).reduce((total, count) => total + count, 0)
              : conversations.length}</strong></div>
            {admin && <button className="chat-alert-toggle" type="button" onClick={() => void enableDesktopAlerts()}>
              {desktopAlerts ? "ALERTS ON" : "ENABLE ALERTS"}
            </button>}
          </div>
          {admin && (
            <div className="chat-inbox-controls">
              <label className="chat-search-label">SEARCH
                <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Customer or product" />
              </label>
              <label className="chat-filter-label">FILTER
                <select value={filter} onChange={(event) => setFilter(event.target.value as InboxFilter)}>
                  <option value="all">All conversations</option>
                  <option value="unread">Unread</option>
                  <option value="read">Read / open</option>
                  <option value="resolved">Resolved</option>
                </select>
              </label>
            </div>
          )}
          {loadingConversations ? <p className="chat-list-state">Loading conversations…</p>
            : conversationLoadFailed
              ? <div className="chat-list-state"><strong>Conversations could not be loaded.</strong><span>Check your connection, then try again.</span><button className="chat-retry-button" type="button" onClick={() => void retryConversations()}>RETRY</button></div>
            : filteredConversations.length === 0
              ? <div className="chat-list-state"><strong>{admin ? "Your inbox is clear." : "Nothing here just yet."}</strong><span>{admin ? "New customer questions will appear here." : "Curious about a piece? Visit its page and choose “Ask about this product” — we’d love to help."}</span></div>
              : <div className="chat-conversation-list">{filteredConversations.map((conversation) => {
                const unread = unreadCounts[conversation.id] ?? 0;
                return (
                  <button type="button" className={`chat-conversation-card${selectedId === conversation.id ? " is-selected" : ""}`} key={conversation.id} onClick={() => chooseConversation(conversation.id)}>
                    <span className="chat-conversation-main">
                      <strong>{admin ? `Customer ${conversation.customer_id.slice(0, 8)}` : productDetails[conversation.product_id]?.name ?? "Product details unavailable"}</strong>
                      <span>{admin ? productDetails[conversation.product_id]?.name ?? `Product ${conversation.product_id.slice(0, 8)}` : "FORM & FOUND support"}</span>
                      <small>{messageDate(conversation.last_message_at)}</small>
                    </span>
                    <span className="chat-conversation-meta">
                      {unread > 0 && <b aria-label={`${unread} unread messages`}>{unread}</b>}
                      {conversation.status === "resolved" && <small>RESOLVED</small>}
                    </span>
                  </button>
                );
              })}</div>}
        </aside>

        <section className={`chat-thread${selectedId ? " has-selection" : ""}`} aria-label={admin ? "Conversation" : "Your conversation"}>
          {!activeConversation ? (
            <div className="chat-empty-thread"><span className="chat-empty-mark">F&amp;F</span><h2>{admin ? "Choose a conversation" : "How can we help?"}</h2><p>{admin ? "Select a customer from the inbox to read and reply." : "Pick a conversation to see your notes and our team’s replies."}</p></div>
          ) : (
            <>
              <header className="chat-thread-header">
                <button className="chat-back-button" type="button" onClick={() => setSelectedId(null)}>← INBOX</button>
                <Link className="chat-product-preview" to={`/product/${activeProduct?.slug ?? activeConversation.product_id}`}>
                  <img src={activeProduct?.image_url ?? "/product-placeholder.svg"} alt="" />
                  <span><strong>{activeProduct?.name ?? `Product ${activeConversation.product_id.slice(0, 8)}`}</strong><small>{activeProduct?.status ?? "Product details unavailable"} · View product ↗</small></span>
                </Link>
                {admin && (
                  <div className="chat-customer-context">
                    <strong>Customer</strong>
                    <span>Account ID · {activeConversation.customer_id.slice(0, 8)}</span>
                  </div>
                )}
                {admin && <button className="chat-status-button" type="button" onClick={() => void changeStatus(activeConversation.status === "resolved" ? "open" : "resolved")}>
                  {activeConversation.status === "resolved" ? "REOPEN" : "MARK RESOLVED"}
                </button>}
              </header>
              <div className="chat-message-list" aria-live="polite">
                {loadingMessages ? <p className="chat-list-state">Loading message history…</p>
                  : messageLoadFailed
                    ? <div className="chat-list-state"><strong>Messages could not be loaded.</strong><span>Check your connection, then try again.</span><button className="chat-retry-button" type="button" onClick={() => void retryMessages()}>RETRY</button></div>
                  : messages.length === 0
                    ? <div className="chat-thread-welcome"><p className="chat-eyebrow">WE’RE ALL EARS</p><p>Wondering about fit, colour, materials, delivery, or availability? Just send us a note and a real person from our team will get back to you.</p></div>
                    : messages.map((message) => {
                      const ownMessage = message.sender_id === currentUserId;
                      return (
                        <article key={message.id} className={`chat-message${ownMessage ? " is-own" : ""}`}>
                          <div className="chat-message-bubble">
                            {!ownMessage && <span className="chat-message-author">{message.sender_role === "admin" ? "FORM & FOUND" : "CUSTOMER"}</span>}
                            <p>{message.content}</p>
                          </div>
                          <small className="chat-message-meta">{messageDate(message.created_at)}{ownMessage && <> · {message.read_at ? "Read" : "Sent"}</>}</small>
                        </article>
                      );
                    })}
                <div ref={tailRef} />
              </div>
              {activeConversation.status === "resolved" && <div className="chat-resolved-note">All sorted for now? If you have another question, just reply here and we’ll pick up where we left off.</div>}
              <form className="chat-composer" onSubmit={(event) => void sendMessage(event)}>
                <label className="visually-hidden" htmlFor="chat-message-input">Write your message</label>
                <textarea id="chat-message-input" value={draft} maxLength={4000} rows={2} placeholder="Type a message to our team…" onChange={(event) => {
                  setDraft(event.target.value);
                  pendingMessageId.current = null;
                }} />
                <div className="chat-composer-footer"><small>Just between you and our team · {draft.length}/4000</small><button type="submit" className="chat-primary-button" disabled={sending || !draft.trim()}>{sending ? "SENDING…" : "SEND MESSAGE ↗"}</button></div>
              </form>
            </>
          )}
        </section>
      </div>
    </main>
  );
}
