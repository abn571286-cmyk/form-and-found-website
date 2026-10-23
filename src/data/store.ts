const configuredPaymentContact = import.meta.env.VITE_MANUAL_PAYMENT_NUMBER?.trim();
const paymentContactNumber = configuredPaymentContact || "9840180193";
const paymentContactDigits = paymentContactNumber.replace(/\D/g, "");
const paymentContactTel = /^\+?\d{7,15}$/.test(paymentContactNumber)
  ? paymentContactNumber.startsWith("+") ? paymentContactNumber : `+977${paymentContactDigits}`
  : "";

export const store = {
  name: "FORM & FOUND",
  phone: paymentContactNumber,
  phoneLink: paymentContactTel,
  paymentContactNumber,
  manualPaymentReceivingDestinationVerified: false,
  email: "abhiyan080@gmail.com",
  phoneAdditional: "9745233604",
  phoneAdditionalLink: "+9779745233604",
  emailAdditional: "pranax909@gmail.com",
} as const;
