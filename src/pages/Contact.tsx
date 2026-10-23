import { useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { store } from "../data/store";

type ContactValues = {
  name: string;
  email: string;
  subject: string;
  message: string;
};

type ContactField = keyof ContactValues;

const initialValues: ContactValues = {
  name: "",
  email: "",
  subject: "",
  message: "",
};

const fieldNames: ContactField[] = ["name", "email", "subject", "message"];

function validateField(field: ContactField, value: string): string {
  if (!value.trim()) return "This field is required.";
  if (field === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim())) {
    return "Enter a valid email address, such as name@example.com.";
  }
  return "";
}

export default function Contact() {
  const [values, setValues] = useState<ContactValues>(initialValues);
  const [errors, setErrors] = useState<Partial<Record<ContactField, string>>>({});
  const [attemptedSubmit, setAttemptedSubmit] = useState(false);
  const [formStatus, setFormStatus] = useState("");
  const fieldRefs = useRef<Record<ContactField, HTMLInputElement | HTMLTextAreaElement | null>>({
    name: null,
    email: null,
    subject: null,
    message: null,
  });

  function handleChange(field: ContactField, event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) {
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

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
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

    setFormStatus(`Your details are complete, but this demo form does not send messages. Please email ${store.email}.`);
  }

  return (
    <main className="page-shell contact-page">
      <header className="page-heading">
        <p className="eyebrow">FORM & FOUND / GET IN TOUCH</p>
        <h1>Contact<span>.</span></h1>
        <p>Questions about a piece? We’d be glad to hear from you.</p>
      </header>
      <div className="contact-layout">
        <section className="contact-details" aria-labelledby="contact-details-heading">
          <p className="eyebrow">A NOTE FROM YOU</p>
          <h2 id="contact-details-heading">Let’s talk.</h2>
          <p>Send a note using the demo form, or reach us directly at the configured email address.</p>
          <a className="contact-email-link" href={`mailto:${store.email}`}>{store.email}</a>
          <p className="contact-demo-note">
            The form is for demonstration only. It does not store or send your message.
          </p>
        </section>

        <form className="contact-form" onSubmit={handleSubmit} noValidate aria-describedby="contact-form-note">
          <p className="contact-form-note" id="contact-form-note">
            Demo form — messages are not sent. Email us directly if you need a reply.
          </p>
          <label htmlFor="contact-name">Name</label>
          <input
            ref={(element) => { fieldRefs.current.name = element; }}
            id="contact-name"
            name="name"
            type="text"
            autoComplete="name"
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
            required
            value={values.message}
            onChange={(event) => handleChange("message", event)}
            onBlur={() => handleBlur("message")}
            aria-invalid={Boolean(errors.message)}
            aria-describedby={errors.message ? "contact-message-error" : undefined}
          />
          {errors.message && <p className="contact-field-error" id="contact-message-error" role="alert">{errors.message}</p>}

          <button className="button button-lime" type="submit">Check message details</button>
          {formStatus && <p className="contact-form-status" role="status">{formStatus}</p>}
        </form>
      </div>
      <p className="contact-return"><Link className="text-link" to="/">Return home ↗</Link></p>
    </main>
  );
}
