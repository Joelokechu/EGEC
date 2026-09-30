(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const storeKey = "egec-cart-v1";
  const config = window.EGEC_CONFIG;

  let products = [];
  let categories = [];
  let byId = new Map();
  let cart = Object.create(null);
  let activeCategory = "";
  let loaded = false;
  let loading = false;

  const escapeHtml = (value) =>
    String(value ?? "").replace(/[&<>"']/g, (character) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;"
    })[character]);

  const money = (value) =>
    value === null || value === undefined
      ? "Price confirmed by EGEC"
      : `EC$ ${Number(value).toFixed(2)}`;

  function safeImage(value) {
    const text = String(value ?? "").trim();

    if (text.startsWith("/") && !text.startsWith("//")) {
      const parsed = new URL(text, location.origin);
      return parsed.origin === location.origin ? parsed.href : "";
    }

    try {
      const parsed = new URL(text);
      return parsed.protocol === "https:" ? parsed.href : "";
    } catch {
      return "";
    }
  }

  function announce(text) {
    $("status").textContent = text;
  }

  function persist() {
    try {
      localStorage.setItem(storeKey, JSON.stringify(cart));
    } catch {
      // The cart still works when browser storage is unavailable.
    }
  }

  function restoreCart() {
    try {
      const saved = JSON.parse(localStorage.getItem(storeKey) || "{}");

      if (!saved || typeof saved !== "object" || Array.isArray(saved)) {
        return;
      }

      for (const [id, quantity] of Object.entries(saved)) {
        if (
          Number.isInteger(quantity) &&
          quantity > 0 &&
          quantity <= 999
        ) {
          cart[id] = quantity;
        }
      }
    } catch {
      // Ignore invalid saved cart data.
    }
  }

  async function readTable(table, columns) {
    const rows = [];
    const pageSize = 500;
    const root = config.supabaseUrl.replace(/\/+$/, "");

    for (let offset = 0; ; offset += pageSize) {
      const url = new URL(`${root}/rest/v1/${table}`);

      url.searchParams.set("select", columns);
      url.searchParams.set("active", "eq.true");
      url.searchParams.set("order", "sort_order.asc,id.asc");
      url.searchParams.set("limit", String(pageSize));
      url.searchParams.set("offset", String(offset));

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15000);

      let page;

      try {
        const response = await fetch(url, {
          headers: {
            apikey: config.supabasePublishableKey,
            Accept: "application/json"
          },
          cache: "no-store",
          signal: controller.signal
        });

        if (!response.ok) {
          throw new Error("The catalogue could not be loaded.");
        }

        page = await response.json();

        if (!Array.isArray(page)) {
          throw new Error("Unexpected catalogue response.");
        }
      } finally {
        clearTimeout(timeout);
      }

      rows.push(...page);

      if (page.length < pageSize) return rows;
    }
  }

  function renderFilters() {
    const options = [
      { id: "", name: "All" },
      ...categories
    ];

    $("filters").innerHTML = options.map((category) => `
      <button type="button" class="filter"
              aria-pressed="${category.id === activeCategory}"
              data-category="${escapeHtml(category.id)}">
        ${escapeHtml(category.name)}
      </button>
    `).join("");
  }

  function renderProducts() {
    const visible = products.filter((product) =>
      !activeCategory || product.category_id === activeCategory
    );

    if (!visible.length) {
      $("product-grid").innerHTML =
        "<p>No products are currently available in this category.</p>";
      return;
    }

    $("product-grid").innerHTML = visible.map((product) => {
      const src = safeImage(product.image_url);

      return `
        <article class="product-card">
          <div class="product-image">
            ${src ? `
              <img src="${escapeHtml(src)}"
                   alt="${escapeHtml(product.name)}" loading="lazy">
            ` : `
              <span>${escapeHtml(product.name)}</span>
            `}
          </div>

          <div class="product-body">
            <span class="product-category">
              ${escapeHtml(product.category_name)}
            </span>
            <h3>${escapeHtml(product.name)}</h3>
            <p>${escapeHtml(product.description)}</p>

            <div class="product-meta">
              ${product.size ? `${escapeHtml(product.size)} · ` : ""}
              ${escapeHtml(money(product.price))}
            </div>

            <div class="product-actions">
              <input type="number" min="1" max="99" step="1" value="1"
                     aria-label="Units of ${escapeHtml(product.name)}"
                     data-quantity="${escapeHtml(product.id)}">
              <button type="button"
                      data-add="${escapeHtml(product.id)}">
                Add to cart
              </button>
            </div>
          </div>
        </article>
      `;
    }).join("");
  }

  function renderCart() {
    const lines = Object.entries(cart).filter(([id]) => byId.has(id));
    const count = lines.reduce((sum, [, quantity]) => sum + quantity, 0);

    $("cart-count").textContent = String(count);
    $("cart-count").hidden = !count;
    $("order-button").disabled = !loaded || !count;

    $("cart-intro").textContent = !loaded
      ? "Loading the current catalogue…"
      : count
        ? `${count} unit${count === 1 ? "" : "s"} selected`
        : "Your cart is currently empty.";

    if (!loaded) {
      $("cart-lines").innerHTML =
        "<p>Please wait while we load the current product information.</p>";
      return;
    }

    $("cart-lines").innerHTML = lines.length
      ? lines.map(([id, quantity]) => {
          const product = byId.get(id);
          const src = safeImage(product.image_url);

          return `
            <div class="cart-line">
              ${src
                ? `<img src="${escapeHtml(src)}" alt="">`
                : '<div aria-hidden="true"></div>'}

              <div>
                <h3>${escapeHtml(product.name)}</h3>
                <small>
                  ${escapeHtml(product.size)}
                  ${product.size ? " · " : ""}
                  ${escapeHtml(money(product.price))}
                </small>

                <div class="quantity-controls">
                  <button type="button"
                          data-adjust="${escapeHtml(id)}" data-delta="-1"
                          aria-label="Remove one ${escapeHtml(product.name)}">
                    −
                  </button>
                  <strong>${quantity}</strong>
                  <button type="button"
                          data-adjust="${escapeHtml(id)}" data-delta="1"
                          ${quantity >= 999 ? "disabled" : ""}
                          aria-label="Add one ${escapeHtml(product.name)}">
                    +
                  </button>
                </div>
              </div>
            </div>
          `;
        }).join("")
      : `
          <div class="cart-empty">
            <strong>Nothing here yet</strong>
            <p>Add a product from the catalogue to begin.</p>
          </div>
        `;
  }

  async function loadCatalogue() {
    if (loading) return;
    loading = true;

    $("product-grid").setAttribute("aria-busy", "true");
    $("product-grid").innerHTML = "<p>Loading the EGEC collection…</p>";

    try {
      if (!config?.supabaseUrl || !config?.supabasePublishableKey) {
        throw new Error("Missing connection settings.");
      }

      const results = await Promise.allSettled([
        readTable("egec_categories", "id,name,sort_order,active"),
        readTable(
          "egec_products",
          "id,category_id,name,description,size,image_url,price,sort_order,active"
        )
      ]);

      const failed = results.find((result) => result.status === "rejected");
      if (failed) throw failed.reason;

      categories = results[0].value;

      const categoryMap = new Map(
        categories.map((category) => [category.id, category.name])
      );

      products = results[1].value
        .filter((product) => categoryMap.has(product.category_id))
        .map((product) => ({
          ...product,
          category_name: categoryMap.get(product.category_id)
        }));

      byId = new Map(products.map((product) => [product.id, product]));

      let removed = false;

      for (const id of Object.keys(cart)) {
        if (!byId.has(id)) {
          delete cart[id];
          removed = true;
        }
      }

      if (!categoryMap.has(activeCategory)) activeCategory = "";

      loaded = true;
      persist();
      renderFilters();
      renderProducts();
      renderCart();

      if (removed) {
        announce("Unavailable products were removed from your saved cart.");
      }
    } catch {
      loaded = false;
      $("filters").textContent = "";
      $("product-grid").innerHTML = `
        <div>
          <p>We couldn’t load the products. Please try again.</p>
          <button type="button" class="filter" data-retry>
            Try again
          </button>
          <p>
            You can also contact
            <a href="mailto:ezegreenenergy@gmail.com">
              ezegreenenergy@gmail.com
            </a>.
          </p>
        </div>
      `;

      renderCart();
      $("cart-intro").textContent = "Product information is unavailable.";
      $("cart-lines").innerHTML =
        "<p>Close the cart and select “Try again” in the shop.</p>";

      announce("Products could not be loaded. Please try again.");
    } finally {
      loading = false;
      $("product-grid").setAttribute("aria-busy", "false");
    }
  }

  function openCart() {
    $("cart-panel").classList.add("open");
    $("cart-panel").setAttribute("aria-hidden", "false");
    $("cart-backdrop").hidden = false;
    document.body.classList.add("cart-open");

    document.querySelectorAll(
      "body > header, body > main, body > footer"
    ).forEach((element) => {
      element.inert = true;
    });

    $("cart-close").focus();
  }

  function closeCart() {
    $("cart-panel").classList.remove("open");
    $("cart-panel").setAttribute("aria-hidden", "true");
    $("cart-backdrop").hidden = true;
    document.body.classList.remove("cart-open");

    document.querySelectorAll(
      "body > header, body > main, body > footer"
    ).forEach((element) => {
      element.inert = false;
    });

    $("cart-toggle").focus();
  }

  $("filters").addEventListener("click", (event) => {
    const button = event.target.closest("[data-category]");
    if (!button || !loaded) return;

    activeCategory = button.dataset.category;
    renderFilters();
    renderProducts();
  });

  $("product-grid").addEventListener("click", (event) => {
    if (event.target.closest("[data-retry]")) {
      loadCatalogue();
      return;
    }

    const button = event.target.closest("[data-add]");
    if (!button || !loaded) return;

    const id = button.dataset.add;
    const product = byId.get(id);
    if (!product) return;

    const input = button.closest(".product-actions").querySelector("input");
    const quantity = Number(input.value);

    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 99) {
      input.setCustomValidity("Choose 1 to 99 whole units.");
      input.reportValidity();
      input.setCustomValidity("");
      return;
    }

    if ((cart[id] || 0) + quantity > 999) {
      input.setCustomValidity("Your cart can contain up to 999 units per product.");
      input.reportValidity();
      input.setCustomValidity("");
      return;
    }

    cart[id] = (cart[id] || 0) + quantity;
    persist();
    renderCart();

    announce(
      `${quantity} unit${quantity === 1 ? "" : "s"} of ${product.name} added to cart.`
    );

    openCart();
  });

  $("cart-lines").addEventListener("click", (event) => {
    const button = event.target.closest("[data-adjust]");
    if (!button || !loaded) return;

    const id = button.dataset.adjust;
    if (!byId.has(id)) return;

    const next = (cart[id] || 0) + Number(button.dataset.delta);

    if (next <= 0) {
      delete cart[id];
    } else {
      cart[id] = Math.min(999, next);
    }

    persist();
    renderCart();
    announce("Cart updated.");
  });

  $("cart-toggle").addEventListener("click", openCart);
  $("cart-close").addEventListener("click", closeCart);
  $("cart-backdrop").addEventListener("click", closeCart);

  document.addEventListener("keydown", (event) => {
    if (!$("cart-panel").classList.contains("open")) return;

    if (event.key === "Escape") {
      closeCart();
      return;
    }

    if (event.key === "Tab") {
      const focusable = [
        ...$("cart-panel").querySelectorAll(
          'button:not([disabled]), a[href], input:not([disabled]), [tabindex="0"]'
        )
      ].filter((element) => element.getClientRects().length);

      const first = focusable[0];
      const last = focusable[focusable.length - 1];

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    }
  });

  $("order-button").addEventListener("click", () => {
    if (!loaded) return;

    const lines = Object.entries(cart)
      .filter(([id]) => byId.has(id))
      .map(([id, quantity]) => {
        const product = byId.get(id);

        return `${quantity} unit${quantity === 1 ? "" : "s"} × ${
          product.name
        }${product.size ? ` (${product.size})` : ""} — ${
          money(product.price)
        } per unit`;
      });

    if (!lines.length) return;

    const subject = "EGEC product order enquiry";
    const body = [
      "Hello Eze Green Energy Company,",
      "",
      "I would like to enquire about these products:",
      "",
      ...lines,
      "",
      "Please confirm final pricing and availability.",
      "Preferred fulfilment: [collection / delivery]",
      "",
      "Name:",
      "Phone:",
      "Location in Saint Lucia:",
      "",
      "I understand that payment is arranged in person.",
      "",
      "Thank you."
    ].join("\n");

    window.location.href =
      `mailto:ezegreenenergy@gmail.com?subject=${encodeURIComponent(subject)}` +
      `&body=${encodeURIComponent(body)}`;
  });

  $("year").textContent = String(new Date().getFullYear());

  restoreCart();
  renderCart();
  loadCatalogue();
})();
