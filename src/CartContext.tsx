
/* eslint-disable react-refresh/only-export-components */
import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { getVariantStock, isPurchasableVariant } from "./data/products";
import { useProductCatalog } from "./ProductCatalogContext";

export type CartItem = {
  id: string;
  size: string;
  color: string;
  quantity: number;
};

type CartContextType = {
  items: CartItem[];
  addToCart: (id: string, size: string, color: string, quantity?: number) => boolean;
  updateQuantity: (id: string, size: string, color: string, quantity: number) => void;
  removeFromCart: (id: string, size: string, color: string) => void;
  clearCart: () => void;
  itemCount: number;
  subtotal: number;
};

const CartContext = createContext<CartContextType | undefined>(undefined);
const STORAGE_KEY = "form-and-found-cart";

function loadCart(): CartItem[] {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (!saved) return [];

    const parsed: unknown = JSON.parse(saved);
    if (!Array.isArray(parsed)) return [];

    return parsed.filter(
      (item): item is CartItem =>
        item !== null &&
        typeof item === "object" &&
        typeof item.id === "string" &&
        typeof item.size === "string" &&
        typeof item.color === "string" &&
        Number.isInteger(item.quantity) &&
        item.quantity > 0 &&
        item.quantity <= 99,
    );
  } catch (error) {
    console.error("Unable to read the saved bag from this browser.", error);
    return [];
  }
}

export function CartProvider({ children }: { children: ReactNode }) {
  const { products } = useProductCatalog();
  const [items, setItems] = useState<CartItem[]>(loadCart);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
    } catch (error) {
      console.error("Unable to save the bag in this browser.", error);
    }
  }, [items]);

  function addToCart(id: string, size: string, color: string, quantity = 1): boolean {
    const product = products.find((item) => item.id === id);
    const existing = items.find(
      (item) => item.id === id && item.size === size && item.color === color,
    );
    const variantStock = product ? getVariantStock(product, size, color) : undefined;

    if (
      !Number.isInteger(quantity) ||
      quantity < 1 ||
      quantity > 99 ||
      !product ||
      !isPurchasableVariant(product, size, color) ||
      (variantStock !== undefined && (existing?.quantity ?? 0) + quantity > variantStock)
    ) {
      return false;
    }

    setItems((current) => {
      if (existing) {
        return current.map((item) =>
          item.id === id && item.size === size && item.color === color
            ? { ...item, quantity: Math.min(99, item.quantity + quantity) }
            : item,
        );
      }

      return [...current, { id, size, color, quantity }];
    });

    return true;
  }

  function updateQuantity(
    id: string,
    size: string,
    color: string,
    quantity: number,
  ) {
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 99) return;
    const product = products.find((item) => item.id === id);
    const variantStock = product ? getVariantStock(product, size, color) : undefined;
    if (variantStock !== undefined && quantity > variantStock) return;

    setItems((current) =>
      current.map((item) =>
        item.id === id && item.size === size && item.color === color
          ? { ...item, quantity }
          : item,
      ),
    );
  }

  function removeFromCart(id: string, size: string, color: string) {
    setItems((current) =>
      current.filter(
        (item) => !(item.id === id && item.size === size && item.color === color),
      ),
    );
  }

  function clearCart() {
    setItems([]);
  }

  const itemCount = items.reduce((total, item) => total + item.quantity, 0);

  const subtotal = items.reduce((total, item) => {
    const product = products.find((product) => product.id === item.id);
    return total + (product?.price ?? 0) * item.quantity;
  }, 0);

  return (
    <CartContext.Provider
      value={{
        items,
        addToCart,
        updateQuantity,
        removeFromCart,
        clearCart,
        itemCount,
        subtotal,
      }}
    >
      {children}
    </CartContext.Provider>
  );
}

export function useCart() {
  const context = useContext(CartContext);

  if (!context) {
    throw new Error("useCart must be used inside CartProvider");
  }

  return context;
}
