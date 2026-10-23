/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { products as demoProducts, type Product } from "./data/products";
import { loadPublishedProducts, type CatalogState } from "./lib/catalog";
import { supabase } from "./lib/supabase";

type ProductCatalogValue = {
  products: Product[];
  state: CatalogState;
  error: string | null;
  refresh: () => Promise<void>;
};

const ProductCatalogContext = createContext<ProductCatalogValue | null>(null);

export function ProductCatalogProvider({ children }: { children: ReactNode }) {
  const [products, setProducts] = useState<Product[]>(supabase ? [] : demoProducts);
  const [state, setState] = useState<CatalogState>(supabase ? "loading" : "demo");
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    if (!supabase) {
      setProducts(demoProducts);
      setState("demo");
      return;
    }

    setState("loading");
    setError(null);
    try {
      const loaded = await loadPublishedProducts();
      setProducts(loaded);
      setState("ready");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to load products from Supabase.");
      setState("error");
    }
  }

  useEffect(() => {
    if (!supabase) return;
    let active = true;
    void loadPublishedProducts().then((loaded) => {
      if (!active) return;
      setProducts(loaded);
      setState("ready");
      setError(null);
    }).catch((cause: unknown) => {
      if (!active) return;
      setError(cause instanceof Error ? cause.message : "Unable to load products from Supabase.");
      setState("error");
    });
    return () => {
      active = false;
    };
  }, []);

  return (
    <ProductCatalogContext.Provider value={{ products, state, error, refresh }}>
      {children}
    </ProductCatalogContext.Provider>
  );
}

export function useProductCatalog() {
  const context = useContext(ProductCatalogContext);
  if (!context) throw new Error("useProductCatalog must be used inside ProductCatalogProvider");
  return context;
}
