/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { useProductCatalog } from "./ProductCatalogContext";

type WishlistContextValue = {
  ids: string[];
  count: number;
  has: (id: string) => boolean;
  toggle: (id: string) => void;
};

const WishlistContext = createContext<WishlistContextValue | undefined>(undefined);
const STORAGE_KEY = "form-and-found-wishlist";

function loadWishlist(): string[] {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]");
    if (!Array.isArray(saved)) return [];
    return [...new Set(saved.filter((id): id is string => typeof id === "string"))];
  } catch (error) {
    console.error("Unable to read the saved wishlist from this browser.", error);
    return [];
  }
}

export function WishlistProvider({ children }: { children: ReactNode }) {
  const { products } = useProductCatalog();
  const [ids, setIds] = useState<string[]>(loadWishlist);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(ids));
    } catch (error) {
      console.error("Unable to save the wishlist in this browser.", error);
    }
  }, [ids]);

  function toggle(id: string) {
    if (!products.some((product) => product.id === id)) return;
    setIds((current) => current.includes(id)
      ? current.filter((savedId) => savedId !== id)
      : [...current, id]);
  }

  return (
    <WishlistContext.Provider value={{
      ids: ids.filter((id) => products.some((product) => product.id === id)),
      count: ids.filter((id) => products.some((product) => product.id === id)).length,
      has: (id) => ids.includes(id) && products.some((product) => product.id === id),
      toggle,
    }}>
      {children}
    </WishlistContext.Provider>
  );
}

export function useWishlist() {
  const context = useContext(WishlistContext);
  if (!context) throw new Error("useWishlist must be used inside WishlistProvider");
  return context;
}
