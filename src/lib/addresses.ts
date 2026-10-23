import type { Json } from "./database.types";

export type DeliveryAddress = {
  full_name: string;
  recipient_phone: string;
  province: string;
  district: string;
  municipality: string;
  ward: string;
  street: string;
  postal_code: string;
  delivery_instructions: string;
  is_default: boolean;
};

export const DELIVERY_FEE_NPR = 120;
export const DELIVERY_COVERAGE_SETTING_KEY = "delivery_coverage_districts";
export const DELIVERY_POSTAL_CODE_SETTING_KEY = "delivery_coverage_postal_codes";

function normalizedRegion(value: string) {
  return value.trim().toLocaleLowerCase().replace(/\s+district$/i, "").replace(/\s+province$/i, "").trim();
}

export function parseDeliveryDistricts(value: Json | undefined): string[] | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  const districts = value.filter((district): district is string =>
    typeof district === "string" && district.trim().length > 0
  ).map((district) => normalizedRegion(district));
  return districts.length === value.length ? districts : null;
}

export function parseDeliveryPostalCodes(value: Json | undefined): Record<string, string[]> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const coverage: Record<string, string[]> = {};
  for (const [district, codes] of Object.entries(value)) {
    if (!Array.isArray(codes)) {
      return null;
    }
    const stringCodes = codes.filter((code): code is string =>
      typeof code === "string" && code.trim().length > 0
    );
    if (stringCodes.length !== codes.length) return null;
    coverage[normalizedRegion(district)] = stringCodes.map((code) => code.trim());
  }
  return Object.keys(coverage).length > 0 ? coverage : null;
}

export function isSupportedDeliveryAddress(
  address: Pick<DeliveryAddress, "province" | "district">,
  supportedDistricts: string[],
) {
  return normalizedRegion(address.province) === "bagmati" &&
    supportedDistricts.includes(normalizedRegion(address.district));
}

export function isSupportedDeliveryPostalCode(
  postalCode: string,
  district: string,
  supportedPostalCodes: Record<string, string[]> | null,
) {
  if (!postalCode.trim()) return true;
  const allowedCodes = supportedPostalCodes?.[normalizedRegion(district)];
  return allowedCodes?.includes(postalCode.trim()) ?? false;
}

export function parseDeliveryAddress(value: Json): DeliveryAddress {
  const address: Record<string, Json | undefined> =
    typeof value === "object" && value !== null && !Array.isArray(value) ? value : {};
  const readString = (key: string, fallback?: string) => {
    const current = address[key];
    if (typeof current === "string") return current;
    if (fallback && typeof address[fallback] === "string") return address[fallback] as string;
    return "";
  };

  return {
    full_name: readString("full_name", "recipient_name"),
    recipient_phone: readString("recipient_phone", "phone"),
    province: readString("province"),
    district: readString("district"),
    municipality: readString("municipality", "city"),
    ward: readString("ward"),
    street: readString("street", "address"),
    postal_code: readString("postal_code"),
    delivery_instructions: readString("delivery_instructions"),
    is_default: address.is_default === true,
  };
}

export function serializeDeliveryAddress(address: DeliveryAddress, existing?: Json): Json {
  const previous: Record<string, Json | undefined> =
    typeof existing === "object" && existing !== null && !Array.isArray(existing) ? existing : {};
  return {
    ...previous,
    full_name: address.full_name.trim(),
    recipient_phone: address.recipient_phone.trim(),
    province: address.province.trim(),
    district: address.district.trim(),
    municipality: address.municipality.trim(),
    ward: address.ward.trim(),
    street: address.street.trim(),
    postal_code: address.postal_code.trim(),
    delivery_instructions: address.delivery_instructions.trim(),
    is_default: address.is_default,
  };
}
