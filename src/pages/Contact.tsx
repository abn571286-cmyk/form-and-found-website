import { useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { store } from "../data/store";
import { supabase } from "../lib/supabase";

type ContactValues = {
  name: string;
  email: string;
  subject: string;
  message: string;
  company: string;
};

type ContactField = keyof ContactValues;

const initialValues: ContactValues = {
  name: "",
  email: "",
  subject: "",
  message: "",
  company: "",
};

const fieldNames: Array<Exclude<ContactField, "company">> = ["name", "email", "subject", "message"];
const submissionStorageKey = "form-and-found-contact-submission";

function getSubmissionId() {
  const existing = sessionStorage.getItem(submissionStorageKey);
  if (existing && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(existing)) {
    return existing;
  }
  const submissionId = crypto.randomUUID();
  sessionStorage.setItem(submissionStorageKey, submissionId);
  return submissionId;
}

function validateField(field: ContactField, value: string): string {
  const clean = value.trim();
  if (!clean) return "This field is required.";
  if (field === "name" && clean.length > 100) return "Name must be 100 characters or fewer.";
  if (field === "email" && (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean) || clean.length > 254)) {
    return "Enter a valid email address.";
  }
  if (field === "subject" && clean.length > 160) return "Subject must be 160 characters or fewer.";
  if (field === "message" && clean.length > 5000) return "Message must be 5,000 characters or fewer.";
  return "";
}

export default function Contact() {
  const [values, setValues] = useState<ContactValues>(initialValues);
  const [errors, setErrors] = useState<Partial<Record<ContactField, string>>>({});
  const [attemptedSubmit, setAttemptedSubmit] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [formStatus, setFormStatus] = useState("");
  const [statusError, setStatusError] = useState(false);
  const submittingRef = useRef(false);
  const fieldRefs = useRef<Record<Exclude<ContactField, "company">, HTMLInputElement | HTMLTextAreaElement | null>>({
    name: null,
    email: null,
    subject: null,
    message: null,
  });

  function handleChange(field: ContactField, event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) {
    if (submittingRef.current) return;
    sessionStorage.removeItem(submissionStorageKey);
    const value = event.target.value;
    setValues((current) => ({ ...current, [field]: value }));
    setFormStatus("");
    if (attemptedSubmit || errors[field]) {
      setErrors((current) => ({ ...current, [field]: validateField(field, value) }));
    }
  }

  function handleBlur(field: ContactField) {
    setErrors((current) => ({ ...current, [field]: validateField(field, values[field]) }));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submittingRef.current) return;
    setAttemptedSubmit(true);
    const nextErrors = Object.fromEntries(
      fieldNames.map((field) => [field, validateField(field, values[field])]),
    ) as Record<ContactField, string>;
    setErrors(nextErrors);

    const firstInvalid = fieldNames.find((field) => nextErrors[field]);
    if (firstInvalid) {
      setFormStatus("");
      fieldRefs.current[firstInvalid]?.focus();
      return;
    }
    if (!supabase) {
      setStatusError(true);
      setFormStatus("Contact submissions are not configured here. Please contact us directly using the details shown.");
      return;
    }

    submittingRef.current = true;
    setSubmitting(true);
    setStatusError(false);
    setFormStatus("");
    try {
      const { data, error } = await supabase.functions.invoke("contact-message", {
        body: {
          name: values.name.trim(),
          email: values.email.trim().toLowerCase(),
          subject: values.subject.trim(),
          message: values.message.trim(),
          company: values.company,
          submission_id: getSubmissionId(),
        },
      });
      if (error) throw error;
      if (typeof data !== "object" || data === null || !("saved" in data) || data.saved !== true) {
        throw new Error("The server did not confirm that your message was saved.");
      }

      if (data.notificationSent === true) {
        setFormStatus("Your message was saved and sent to our support inbox. We’ll be in touch.");
      } else if (data.notificationConfigured === false) {
        setFormStatus(`Your message was saved, but email notifications are not configured. For a direct reply, email ${store.email} or ${store.emailAdditional}.`);
      } else {
        setFormStatus(`Your message was saved, but our email notification could not be sent. You can reach us directly at ${store.email} or ${store.emailAdditional}.`);
      }
      setValues(initialValues);
      setErrors({});
      setAttemptedSubmit(false);
      sessionStorage.removeItem(submissionStorageKey);
    } catch (cause) {
      setStatusError(true);
      setFormStatus(cause instanceof Error
        ? `We could not confirm that your message was saved: ${cause.message}`
        : "We could not confirm that your message was saved. Please try again or contact us directly.");
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  }

  return (
    <main className="page-shell contact-page">
      <header className="page-heading">
        <p className="eyebrow">FORM & FOUND / GET IN TOUCH</p>
        <h1>Contact<span>.</span></h1>
        <p>Questions about a piece or an order? We’d be glad to hear from you.</p>
      </header>
      <div className="contact-layout">
        <section className="contact-details" aria-labelledby="contact-details-heading">
          <p className="eyebrow">A NOTE FROM YOU</p>
          <h2 id="contact-details-heading">Let’s talk.</h2>
          <p>Send us a message or reach our team directly.</p>
          <div className="contact-method-list">
            <div>
              <strong>EMAIL</strong>
              <a className="contact-email-link" href={`mailto:${store.email}`}>{store.email}</a>
              <a className="contact-email-link" href={`mailto:${store.emailAdditional}`}>{store.emailAdditional}</a>
            </div>
            <div>
              <strong>PHONE</strong>
              <a className="contact-email-link" href={`tel:${store.phoneLink}`}>{store.phone}</a>
              <a className="contact-email-link" href={`tel:${store.phoneAdditionalLink}`}>{store.phoneAdditional}</a>
            </div>
          </div>
          {!supabase && <p className="contact-demo-note">Online submissions are unavailable until the Supabase project is configured. Please contact us by email or phone.</p>}
        </section>

        <form className="contact-form" onSubmit={(event) => void handleSubmit(event)} noValidate aria-describedby="contact-form-note">
          <p className="contact-form-note" id="contact-form-note">
            Your message is securely submitted to FORM & FOUND support. Please do not include payment details or passwords.
          </p>
          <label htmlFor="contact-name">Name</label>
          <input
            ref={(element) => { fieldRefs.current.name = element; }}
            id="contact-name"
            name="name"
            type="text"
            autoComplete="name"
            maxLength={100}
            required
            value={values.name}
            onChange={(event) => handleChange("name", event)}
            onBlur={() => handleBlur("name")}
            aria-invalid={Boolean(errors.name)}
            aria-describedby={errors.name ? "contact-name-error" : undefined}
          />
          {errors.name && <p className="contact-field-error" id="contact-name-error" role="alert">{errors.name}</p>}

          <label htmlFor="contact-email">Email</label>
          <input
            ref={(element) => { fieldRefs.current.email = element; }}
            id="contact-email"
            name="email"
            type="email"
            autoComplete="email"
            inputMode="email"
            maxLength={254}
            required
            value={values.email}
            onChange={(event) => handleChange("email", event)}
            onBlur={() => handleBlur("email")}
            aria-invalid={Boolean(errors.email)}
            aria-describedby={errors.email ? "contact-email-error" : undefined}
          />
          {errors.email && <p className="contact-field-error" id="contact-email-error" role="alert">{errors.email}</p>}

          <label htmlFor="contact-subject">Subject</label>
          <input
            ref={(element) => { fieldRefs.current.subject = element; }}
            id="contact-subject"
            name="subject"
            type="text"
            maxLength={160}
            required
            value={values.subject}
            onChange={(event) => handleChange("subject", event)}
            onBlur={() => handleBlur("subject")}
            aria-invalid={Boolean(errors.subject)}
            aria-describedby={errors.subject ? "contact-subject-error" : undefined}
          />
          {errors.subject && <p className="contact-field-error" id="contact-subject-error" role="alert">{errors.subject}</p>}

          <label htmlFor="contact-message">Message</label>
          <textarea
            ref={(element) => { fieldRefs.current.message = element; }}
            id="contact-message"
            name="message"
            rows={6}
            maxLength={5000}
            required
            value={values.message}
            onChange={(event) => handleChange("message", event)}
            onBlur={() => handleBlur("message")}
            aria-invalid={Boolean(errors.message)}
            aria-describedby={errors.message ? "contact-message-error" : undefined}
          />
          {errors.message && <p className="contact-field-error" id="contact-message-error" role="alert">{errors.message}</p>}

          <div className="contact-honeypot" aria-hidden="true">
            <label htmlFor="contact-company">Leave this field empty</label>
            <input id="contact-company" name="company" tabIndex={-1} autoComplete="off" value={values.company} onChange={(event) => handleChange("company", event)} />
          </div>
          <button className="button button-lime" type="submit" disabled={submitting}>
            {submitting ? "SENDING…" : "SEND MESSAGE ↗"}
          </button>
          {formStatus && <p className={`contact-form-status${statusError ? " is-error" : ""}`} role={statusError ? "alert" : "status"}>{formStatus}</p>}
        </form>
      </div>
      <p className="contact-return"><Link className="text-link" to="/">Return home ↗</Link></p>
    </main>
  );
}
