(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const config = window.EGEC_CONFIG;
  const cartKey = "egec-cart-v1";
  const pendingKey = "egec-pending-order-v1";

  let products = [];
  let categories = [];
  let byId = new Map();
  let cart = Object.create(null);
  let activeCategory = "";
  let loaded = false;
  let loading = false;
  let sending = false;
  let pending = null;

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

  function announce(message) {
    $("status").textContent = message;
  }

  function showMessage(message) {
    $("order-message").textContent = message;
    $("order-message").hidden = !message;
  }

  function persistCart() {
    try {
      localStorage.setItem(cartKey, JSON.stringify(cart));
    } catch {
      // The current cart remains usable without browser storage.
    }
  }

  function persistPending() {
    try {
      if (pending) {
        sessionStorage.setItem(pendingKey, JSON.stringify(pending));
      } else {
        sessionStorage.removeItem(pendingKey);
      }
    } catch {
      // Retry information remains in memory for this page.
    }
  }

  function restore() {
    try {
      const saved = JSON.parse(localStorage.getItem(cartKey) || "{}");

      if (saved && typeof saved === "object" && !Array.isArray(saved)) {
        for (const [id, quantity] of Object.entries(saved)) {
          if (
            Number.isInteger(quantity) &&
            quantity >= 1 &&
            quantity <= 999
          ) {
            cart[id] = quantity;
          }
        }
      }
    } catch {
      // Ignore invalid saved cart data.
    }

    try {
      const saved = JSON.parse(
        sessionStorage.getItem(pendingKey) || "null"
      );

      if (
        saved &&
        typeof saved.submission_key === "string" &&
        typeof saved.customer_name === "string" &&
        typeof saved.customer_email === "string" &&
        typeof saved.customer_phone === "string" &&
        Array.isArray(saved.items) &&
        saved.items.length
      ) {
        pending = saved;
      }
    } catch {
      // Ignore invalid retry data.
    }
  }

  function safeImage(value) {
    try {
      const source = String(value ?? "").trim();
      if (!source) return "";

      const parsed = new URL(source, location.origin);

      if (source.startsWith("/") && !source.startsWith("//")) {
        return parsed.origin === location.origin ? parsed.href : "";
      }

      return parsed.protocol === "https:" ? parsed.href : "";
    } catch {
      return "";
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
      const timer = setTimeout(() => controller.abort(), 15000);

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

        if (!response.ok) throw new Error("Catalogue unavailable.");

        page = await response.json();
        if (!Array.isArray(page)) throw new Error("Invalid catalogue.");
      } finally {
        clearTimeout(timer);
      }

      rows.push(...page);
      if (page.length < pageSize) return rows;
    }
  }

  function renderFilters() {
    $("filters").innerHTML = [
      { id: "", name: "All" },
      ...categories
    ].map((category) => `
      <button type="button" class="filter"
              data-category="${escapeHtml(category.id)}"
              aria-pressed="${category.id === activeCategory}">
        ${escapeHtml(category.name)}
      </button>
    `).join("");
  }

  function renderProducts() {
    const visible = products.filter((product) =>
      !activeCategory || product.category_id === activeCategory
    );

    $("product-grid").innerHTML = visible.length
      ? visible.map((product) => {
          const source = safeImage(product.image_url);

          return `
            <article class="product-card">
              <div class="product-image">
                ${source
                  ? `<img src="${escapeHtml(source)}"
                          alt="${escapeHtml(product.name)}" loading="lazy">`
                  : `<span>${escapeHtml(product.name)}</span>`}
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
                         aria-label="Units of ${escapeHtml(product.name)}">
                  <button type="button" data-add="${escapeHtml(product.id)}">
                    Add to cart
                  </button>
                </div>
              </div>
            </article>
          `;
        }).join("")
      : "<p>No products are currently available in this category.</p>";
  }

  function updateDelivery() {
    const delivery = $("fulfilment-method").value === "delivery";
    $("delivery-fields").hidden = !delivery;
    $("delivery-address").disabled = !delivery;
    $("delivery-address").required = delivery;
  }

  function renderCart() {
    const lines = Object.entries(cart).filter(([id]) => byId.has(id));
    const count = lines.reduce((sum, [, quantity]) => sum + quantity, 0);
    const locked = sending || Boolean(pending);

    $("cart-count").textContent = String(count);
    $("cart-count").hidden = !count;

    $("cart-intro").textContent = !loaded
      ? "Loading the current catalogue…"
      : count
        ? `${count} unit${count === 1 ? "" : "s"} selected`
        : "Your cart is currently empty.";

    $("order-form").hidden = !pending && (!loaded || !count);
    $("order-fields").disabled = locked;
    $("cart-lines").inert = locked;
    $("order-button").disabled =
      sending || (!pending && (!loaded || !count));

    $("order-button").textContent = sending
      ? "Sending your request…"
      : pending
        ? "Retry the same request"
        : "Send order request ↗";

    if (!loaded) {
      $("cart-lines").innerHTML =
        "<p>Please wait while we load the current product information.</p>";
      return;
    }

    $("cart-lines").innerHTML = lines.length
      ? lines.map(([id, quantity]) => {
          const product = byId.get(id);
          const source = safeImage(product.image_url);

          return `
            <div class="cart-line">
              ${source
                ? `<img src="${escapeHtml(source)}" alt="">`
                : '<div aria-hidden="true"></div>'}
              <div>
                <h3>${escapeHtml(product.name)}</h3>
                <small>
                  ${escapeHtml(product.size)}
                  ${product.size ? " · " : ""}
                  ${escapeHtml(money(product.price))}
                </small>
                <div class="quantity-controls">
                  <button type="button" data-adjust="${escapeHtml(id)}"
                          data-delta="-1" ${locked ? "disabled" : ""}
                          aria-label="Remove one ${escapeHtml(product.name)}">
                    −
                  </button>
                  <strong>${quantity}</strong>
                  <button type="button" data-adjust="${escapeHtml(id)}"
                          data-delta="1"
                          ${locked || quantity >= 999 ? "disabled" : ""}
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
      persistCart();
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
          <button type="button" class="filter" data-retry>Try again</button>
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
      announce("Products could not be loaded.");
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

  function fillPendingForm() {
    if (!pending) return;

    $("customer-name").value = pending.customer_name;
    $("customer-email").value = pending.customer_email;
    $("customer-phone").value = pending.customer_phone;
    $("fulfilment-method").value = pending.fulfilment_method;
    $("delivery-address").value = pending.delivery_address || "";
    $("customer-notes").value = pending.customer_notes || "";
    $("order-agreement").checked = true;
    updateDelivery();
  }

  function buildRequest() {
    const items = Object.entries(cart)
      .filter(([id]) => byId.has(id))
      .map(([product_id, quantity]) => ({ product_id, quantity }));

    if (!items.length) throw new Error("Add a product before ordering.");

    if (items.length > 50) {
      throw new Error("Please select no more than 50 different products.");
    }

    const name = $("customer-name").value.trim();
    const email = $("customer-email").value.trim().toLowerCase();
    const phone = $("customer-phone").value.trim();
    const fulfilment = $("fulfilment-method").value;
    const address = fulfilment === "delivery"
      ? $("delivery-address").value.trim()
      : "";

    if (!name || !email || phone.length < 5) {
      throw new Error("Please check your name, email address and phone number.");
    }

    if (fulfilment === "delivery" && !address) {
      throw new Error("Please enter your delivery address.");
    }

    if (!crypto.randomUUID) {
      throw new Error(
        "Please use a current browser to send your request, or contact EGEC."
      );
    }

    return {
      submission_key: crypto.randomUUID(),
      customer_name: name,
      customer_email: email,
      customer_phone: phone,
      fulfilment_method: fulfilment,
      delivery_address: address,
      customer_notes: $("customer-notes").value.trim(),
      website: $("order-website").value,
      items
    };
  }

  async function submitOrder(event) {
    event.preventDefault();
    if (sending) return;

    if (!config?.supabaseUrl || !config?.supabasePublishableKey) {
      showMessage("Ordering is unavailable. Please contact EGEC.");
      return;
    }

    if (!pending) {
      if (!loaded || !$("order-form").reportValidity()) return;

      try {
        pending = buildRequest();
        persistPending();
      } catch (error) {
        showMessage(error.message);
        return;
      }
    }

    const request = pending;
    sending = true;
    $("order-result").hidden = true;
    showMessage("Sending your request. Please wait…");
    renderCart();

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 60000);

    try {
      const root = config.supabaseUrl.replace(/\/+$/, "");

      const response = await fetch(`${root}/functions/v1/create-order`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: config.supabasePublishableKey
        },
        body: JSON.stringify(request),
        signal: controller.signal
      });

      let result;

      try {
        result = await response.json();
      } catch {
        throw new Error("The response could not be confirmed.");
      }

      if (!response.ok || result.success !== true) {
        /*
         * Validation and rate-limit responses mean this request
         * was rejected before a new order was saved.
         * For other failures, keep the same submission key.
         */
        if (response.status === 400 || response.status === 429) {
          pending = null;
          persistPending();
          showMessage(
            result.error || "Please check your request and try again."
          );
          return;
        }

        throw new Error("The request could not be confirmed.");
      }

      if (
        typeof result.reference !== "string" ||
        !/^EGEC-[0-9]+$/.test(result.reference)
      ) {
        throw new Error("The order reference could not be confirmed.");
      }

      const notificationsAccepted =
        result.notifications?.customer === "accepted" &&
        result.notifications?.owner === "accepted";

      pending = null;
      persistPending();

      cart = Object.create(null);
      persistCart();
      $("order-form").reset();
      updateDelivery();
      showMessage("");

      $("order-result").innerHTML = `
        <h3>Your request is saved</h3>
        <strong class="order-reference">
          ${escapeHtml(result.reference)}
        </strong>
        <p>
          Keep this reference. EGEC will confirm availability,
          pricing and collection or delivery.
        </p>
        <p>
          ${notificationsAccepted
            ? `Confirmation emails have been submitted for delivery.
               Please check ${escapeHtml(request.customer_email)},
               including your Spam folder.`
            : `An email notification is still pending. Your order is saved.
               If confirmation does not arrive, contact
               <a href="mailto:ezegreenenergy@gmail.com">
                 ezegreenenergy@gmail.com
               </a> and quote your reference.`}
        </p>
        <p><strong>No payment has been taken.</strong></p>
        <button type="button" class="button button-dark" id="continue-shopping">
          Continue shopping
        </button>
      `;

      $("order-result").hidden = false;
      $("continue-shopping").addEventListener("click", closeCart);

      announce(`Order request ${result.reference} saved.`);
      $("order-result").focus();
    } catch {
      /*
       * The server may have saved the request even if the browser
       * did not receive its response. Preserve the exact payload.
       */
      showMessage(
        "We couldn’t confirm the response. Your request may already be saved. " +
        "Click “Retry the same request” to check it without creating another " +
        "order. Your details and selection are temporarily locked."
      );
      announce("The response could not be confirmed. Retry the same request.");
    } finally {
      clearTimeout(timer);
      sending = false;
      renderCart();

      if (!$("order-message").hidden) {
        $("order-message").focus();
      }

      if (!$("order-result").hidden) {
        $("cart-intro").textContent = "Your order request has been saved.";
      }
    }
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

    if (sending || pending) {
      openCart();
      showMessage(
        "Please finish checking your previous request before changing the cart."
      );
      return;
    }

    const id = button.dataset.add;
    const product = byId.get(id);
    if (!product) return;

    const input = button.closest(".product-actions").querySelector("input");
    const quantity = Number(input.value);

    if (
      !Number.isInteger(quantity) ||
      quantity < 1 ||
      quantity > 99 ||
      (cart[id] || 0) + quantity > 999
    ) {
      input.setCustomValidity(
        "Choose 1 to 99 whole units. The cart limit is 999 units per product."
      );
      input.reportValidity();
      input.setCustomValidity("");
      return;
    }

    if (!cart[id] && Object.keys(cart).length >= 50) {
      announce("The cart can contain up to 50 different products.");
      openCart();
      showMessage("The cart can contain up to 50 different products.");
      return;
    }

    cart[id] = (cart[id] || 0) + quantity;
    $("order-result").hidden = true;
    showMessage("");
    persistCart();
    renderCart();
    announce(`${quantity} units of ${product.name} added to cart.`);
    openCart();
  });

  $("cart-lines").addEventListener("click", (event) => {
    const button = event.target.closest("[data-adjust]");
    if (!button || !loaded || sending || pending) return;

    const id = button.dataset.adjust;
    if (!byId.has(id)) return;

    const next = (cart[id] || 0) + Number(button.dataset.delta);

    if (next <= 0) delete cart[id];
    else cart[id] = Math.min(999, next);

    persistCart();
    renderCart();
    showMessage("");
    announce("Cart updated.");

    // Re-rendering replaces the clicked quantity control.
    const replacement = [...$("cart-lines").querySelectorAll("[data-adjust]")]
      .find((element) =>
        element.dataset.adjust === id &&
        element.dataset.delta === button.dataset.delta &&
        !element.disabled
      );

    (replacement || $("cart-close")).focus();
  });

  $("cart-toggle").addEventListener("click", openCart);
  $("cart-close").addEventListener("click", closeCart);
  $("cart-backdrop").addEventListener("click", closeCart);
  $("fulfilment-method").addEventListener("change", updateDelivery);
  $("order-form").addEventListener("submit", submitOrder);

  document.addEventListener("keydown", (event) => {
    if (!$("cart-panel").classList.contains("open")) return;

    if (event.key === "Escape") {
      closeCart();
      return;
    }

    if (event.key !== "Tab") return;

    const focusable = [...$("cart-panel").querySelectorAll(
      'button, a[href], input, select, textarea, [tabindex="0"]'
    )].filter((element) =>
      !element.matches(":disabled") &&
      !element.closest("[inert]") &&
      element.tabIndex >= 0 &&
      element.getClientRects().length
    );

    const first = focusable[0];
    const last = focusable[focusable.length - 1];

    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last?.focus();
    } else if (
      !event.shiftKey &&
      (document.activeElement === last ||
       !focusable.includes(document.activeElement))
    ) {
      event.preventDefault();
      first?.focus();
    }
  });

  $("year").textContent = String(new Date().getFullYear());

  restore();
  fillPendingForm();
  updateDelivery();
  renderCart();
  loadCatalogue();

  if (pending) {
    openCart();
    showMessage(
      "An earlier request is awaiting confirmation. Click “Retry the same " +
      "request” to check it without creating another order."
    );
  }
})();
