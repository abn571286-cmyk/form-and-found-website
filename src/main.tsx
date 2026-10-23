
import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App.tsx";
import { CartProvider } from "./CartContext";
import { WishlistProvider } from "./WishlistContext";
import { ProductCatalogProvider } from "./ProductCatalogContext";
import "./index.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter>
      <ProductCatalogProvider>
        <CartProvider>
          <WishlistProvider>
            <App />
          </WishlistProvider>
        </CartProvider>
      </ProductCatalogProvider>
    </BrowserRouter>
  </React.StrictMode>,
);
