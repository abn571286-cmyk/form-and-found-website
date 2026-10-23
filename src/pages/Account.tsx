
import { useEffect, useState, type FormEvent } from "react";
import type { User } from "@supabase/supabase-js";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabase";
import AccountDashboard from "./AccountDashboard";
import "./Account.css";

type AccountMode = "login" | "signup";

export default function Account({ embedded = false }: { embedded?: boolean }) {
  const location = useLocation();
  const navigate = useNavigate();
  const [mode, setMode] = useState<AccountMode>("login");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(Boolean(supabase));
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState(supabase ? "" : "Account services are not configured. Please try again later.");

  useEffect(() => {
    if (!supabase) return;

    let alive = true;

    supabase.auth.getSession().then(({ data, error: sessionError }) => {
      if (!alive) return;

      if (sessionError) {
        setError(sessionError.message);
      }

      setUser(data.session?.user ?? null);
      setLoading(false);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (alive) {
        setUser(session?.user ?? null);
        setLoading(false);
      }
    });

    return () => {
      alive = false;
      subscription.unsubscribe();
    };
  }, []);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setMessage("");

    if (!supabase) {
      setError("Account services are not configured.");
      return;
    }

    setSubmitting(true);

    try {
      const cleanEmail = email.trim().toLowerCase();

      if (mode === "signup") {
        const { data, error: signupError } = await supabase.auth.signUp({
          email: cleanEmail,
          password,
          options: {
            data: {
              full_name: name.trim(),
            },
            emailRedirectTo: `${window.location.origin}/account`,
          },
        });

        if (signupError) throw signupError;

        if (data.session) {
          setUser(data.session.user);
          setMessage("Your account has been created successfully.");
        } else {
          setMessage(
            "Account request received. Check your email for a verification link before logging in."
          );
          setMode("login");
          setPassword("");
        }
      } else {
        const { data, error: loginError } =
          await supabase.auth.signInWithPassword({
            email: cleanEmail,
            password,
          });

        if (loginError) throw loginError;

        setUser(data.user);
        setMessage("You are now signed in.");
        setPassword("");
        if (new URLSearchParams(location.search).get("next") === "/checkout") {
          navigate("/checkout", { replace: true });
        }
      }
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Something went wrong. Please try again."
      );
    } finally {
      setSubmitting(false);
    }
  }

  async function handleLogout() {
    if (!supabase) return;

    setError("");
    setMessage("");
    setSubmitting(true);

    try {
      const { error: logoutError } = await supabase.auth.signOut();
      if (logoutError) throw logoutError;

      setUser(null);
      setMessage("You have signed out successfully.");
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not sign out."
      );
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <main className="account-page">
        <p className="account-eyebrow">FORM & FOUND / ACCOUNT</p>
        <h1>One moment<span>.</span></h1>
        <p>Checking your account…</p>
      </main>
    );
  }

  if (user) {
    return (
      <>
        {message && (
          <p className="account-message" role="status">{message}</p>
        )}
        {error && (
          <p className="account-error" role="alert">{error}</p>
        )}

        <AccountDashboard user={user} embedded={embedded} onLogout={() => void handleLogout()} />
      </>
    );
  }

  return (
    <main className="account-page">
      <p className="account-eyebrow">FORM & FOUND / YOUR ACCOUNT</p>

      <h1>
        {mode === "login" ? (
          <>Welcome<br />back<span>.</span></>
        ) : (
          <>Find your<br />own form<span>.</span></>
        )}
      </h1>

      <p className="account-intro">
        {mode === "login"
          ? "Sign in to your account and pick up where you left off."
          : "Create an account for your FORM & FOUND journey."}
      </p>

      <div className="account-tabs" aria-label="Account options">
        <button
          type="button"
          className={mode === "login" ? "is-active" : ""}
          onClick={() => {
            setMode("login");
            setError("");
            setMessage("");
          }}
        >
          LOG IN
        </button>
        <button
          type="button"
          className={mode === "signup" ? "is-active" : ""}
          onClick={() => {
            setMode("signup");
            setError("");
            setMessage("");
          }}
        >
          SIGN UP
        </button>
      </div>

      <form className="account-form" onSubmit={handleSubmit}>
        {mode === "signup" && (
          <label>
            Full name
            <input
              type="text"
              autoComplete="name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Your name"
              maxLength={100}
              required
            />
          </label>
        )}

        <label>
          Email address
          <input
            type="email"
            autoComplete="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="you@example.com"
            required
          />
        </label>

        <label>
          Password
          <input
            type="password"
            autoComplete={
              mode === "signup" ? "new-password" : "current-password"
            }
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder={
              mode === "signup"
                ? "At least 8 characters"
                : "Your password"
            }
            minLength={mode === "signup" ? 8 : undefined}
            required
          />
        </label>

        {message && (
          <p className="account-message" role="status">{message}</p>
        )}
        {error && (
          <p className="account-error" role="alert">{error}</p>
        )}

        <button
          className="account-button"
          type="submit"
          disabled={submitting || !supabase}
        >
          {submitting
            ? "PLEASE WAIT…"
            : mode === "login"
              ? "LOG IN ↗"
              : "CREATE ACCOUNT ↗"}
        </button>

        <p className="account-privacy">
          Your account is managed securely through Supabase.
        </p>
      </form>

      <Link className="account-back-link" to="/">
        ← Back to FORM & FOUND
      </Link>
    </main>
  );
}
