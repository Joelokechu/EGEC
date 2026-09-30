(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);

  const message = (text, error = false) => {
    const box = $("status-message");
    box.textContent = text;
    box.classList.toggle("error", error);
    box.hidden = !text;
  };

  const config = window.EGEC_CONFIG;

  if (
    !window.supabase ||
    !config?.supabaseUrl ||
    !config?.supabasePublishableKey
  ) {
    message(
      "Connection settings could not be loaded. Check config.js and refresh.",
      true
    );
    return;
  }

  const db = window.supabase.createClient(
    config.supabaseUrl,
    config.supabasePublishableKey
  );

  const bucket = db.storage.from("egec-products");

  let products = [];
  let categories = [];
  let orders = [];
  let adminId = null;
  let authVersion = 0;
  let previewUrl = null;

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
      ? "Price on request"
      : `EC$ ${Number(value).toFixed(2)}`;

  function imageUrl(value) {
    const text = String(value ?? "").trim();

    if (!text) return "";

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

  function checked(result) {
    if (result.error) throw result.error;
    return result.data;
  }

  function errorText(error) {
    if (error?.code === "23503") {
      return "This category contains products. Move or delete those products first.";
    }

    if (error?.code === "23505") {
      return "That name or record already exists. Please use a different name.";
    }

    return error?.message || "Something went wrong. Please try again.";
  }

  async function run(button, task) {
    if (button.disabled) return;

    button.disabled = true;

    try {
      await task();
    } catch (error) {
      message(errorText(error), true);
    } finally {
      button.disabled = false;
    }
  }

  function requireAdmin() {
    if (!adminId) {
      throw new Error("Please sign in to your admin account.");
    }
  }

  async function readAll(table, sortColumn) {
    const rows = [];
    const pageSize = 500;

    for (let offset = 0; ; offset += pageSize) {
      const page = checked(
        await db
          .from(table)
          .select("*")
          .order(sortColumn)
          .order("id")
          .range(offset, offset + pageSize - 1)
      );

      rows.push(...page);

      if (page.length < pageSize) return rows;
    }
  }

  function badge(text, className = "") {
    return `<span class="badge ${className}">${escapeHtml(text)}</span>`;
  }

  function categoryName(id) {
    return categories.find((category) => category.id === id)?.name
      || "Unknown category";
  }

  function renderCategoryOptions() {
    const previous = $("product-category-filter").value;

    const options = categories.map((category) => `
      <option value="${escapeHtml(category.id)}">
        ${escapeHtml(category.name)}${category.active ? "" : " (hidden)"}
      </option>
    `).join("");

    $("product-category").innerHTML = options;

    $("product-category-filter").innerHTML =
      '<option value="">All categories</option>' + options;

    if (categories.some((category) => category.id === previous)) {
      $("product-category-filter").value = previous;
    }
  }

  function renderProducts() {
    const search = $("product-search").value.trim().toLowerCase();
    const categoryId = $("product-category-filter").value;

    const visible = products.filter((product) =>
      product.name.toLowerCase().includes(search) &&
      (!categoryId || product.category_id === categoryId)
    );

    $("products-table").innerHTML = visible.map((product) => {
      const src = imageUrl(product.image_url);

      return `
        <tr>
          <td>
            <div class="product-cell">
              ${src ? `
                <img src="${escapeHtml(src)}"
                     alt="${escapeHtml(product.name)}"
                     loading="lazy">
              ` : ""}
              <div>
                <strong>${escapeHtml(product.name)}</strong>
                <small>${escapeHtml(product.size)}</small>
              </div>
            </div>
          </td>
          <td>${escapeHtml(categoryName(product.category_id))}</td>
          <td>${escapeHtml(money(product.price))}</td>
          <td>
            ${product.active
              ? badge("Visible")
              : badge("Hidden", "hidden")}
          </td>
          <td>
            <div class="row-actions">
              <button type="button" data-action="edit"
                      data-id="${escapeHtml(product.id)}">Edit</button>
              <button type="button" class="button-danger"
                      data-action="delete"
                      data-id="${escapeHtml(product.id)}">Delete</button>
            </div>
          </td>
        </tr>
      `;
    }).join("");

    $("products-empty").hidden = visible.length > 0;
  }

  function renderCategories() {
    $("categories-table").innerHTML = categories.map((category) => `
      <tr>
        <td><strong>${escapeHtml(category.name)}</strong></td>
        <td>${escapeHtml(category.sort_order)}</td>
        <td>
          ${category.active
            ? badge("Visible")
            : badge("Hidden", "hidden")}
        </td>
        <td>
          <div class="row-actions">
            <button type="button" data-action="edit"
                    data-id="${escapeHtml(category.id)}">Edit</button>
            <button type="button" class="button-danger"
                    data-action="delete"
                    data-id="${escapeHtml(category.id)}">Delete</button>
          </div>
        </td>
      </tr>
    `).join("");

    $("categories-empty").hidden = categories.length > 0;
  }

  function renderOrders() {
    const status = $("order-status-filter").value;
    const visible = orders.filter((order) =>
      !status || order.status === status
    );

    const formatDate = (value) =>
      new Date(value).toLocaleString("en-GB", {
        timeZone: "America/St_Lucia",
        dateStyle: "medium",
        timeStyle: "short"
      });

    $("orders-table").innerHTML = visible.map((order) => `
      <tr>
        <td><strong>${escapeHtml(order.order_reference)}</strong></td>
        <td>${escapeHtml(order.customer_name)}</td>
        <td>${escapeHtml(formatDate(order.created_at))}</td>
        <td>${escapeHtml(order.fulfilment_method)}</td>
        <td>${badge(order.status, order.status)}</td>
        <td>
          <button type="button" data-action="view"
                  data-id="${escapeHtml(order.id)}">View</button>
        </td>
      </tr>
    `).join("");

    $("orders-empty").hidden = visible.length > 0;
  }

  async function loadCatalogue() {
    const version = authVersion;

    const results = await Promise.allSettled([
      readAll("egec_categories", "sort_order"),
      readAll("egec_products", "sort_order")
    ]);

    const failed = results.find((result) => result.status === "rejected");
    if (failed) throw failed.reason;

    if (version !== authVersion || !adminId) return;

    categories = results[0].value;
    products = results[1].value;

    renderCategoryOptions();
    renderCategories();
    renderProducts();
  }

  async function loadOrders() {
    const version = authVersion;
    const rows = await readAll("egec_orders", "created_at");

    if (version !== authVersion || !adminId) return;

    orders = rows.reverse();
    renderOrders();
  }

  function resetPreview() {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    previewUrl = null;
    $("product-image-preview").hidden = true;
    $("product-image-preview").removeAttribute("src");
  }

  function updatePreview() {
    resetPreview();

    const file = $("product-image-file").files[0];
    let src = imageUrl($("product-image-url").value);

    if (file) {
      previewUrl = URL.createObjectURL(file);
      src = previewUrl;
    }

    if (src) {
      $("product-image-preview").src = src;
      $("product-image-preview").hidden = false;
    }
  }

  function signedOut() {
    authVersion += 1;
    adminId = null;
    products = [];
    categories = [];
    orders = [];

    $("dashboard").hidden = true;
    $("login-section").hidden = false;
    $("sign-out").hidden = true;
    $("signed-in-email").textContent = "";
    $("products-table").textContent = "";
    $("categories-table").textContent = "";
    $("orders-table").textContent = "";
    $("order-details").textContent = "";

    document.querySelectorAll("dialog[open]").forEach((dialog) => {
      dialog.close();
    });

    resetPreview();
    $("product-form").reset();
    $("category-form").reset();
    $("order-form").reset();
    $("login-password").value = "";
  }

  async function checkSession() {
    const version = ++authVersion;

    try {
      const result = await db.auth.getUser();
      if (version !== authVersion) return;

      if (result.error || !result.data.user) {
        signedOut();
        return;
      }

      const allowed = checked(await db.rpc("is_egec_admin"));
      if (version !== authVersion) return;

      if (!allowed) {
        signedOut();
        message("This account does not have EGEC admin access.", true);
        await db.auth.signOut({ scope: "local" });
        return;
      }

      adminId = result.data.user.id;
      $("login-section").hidden = true;
      $("dashboard").hidden = false;
      $("sign-out").hidden = false;
      $("signed-in-email").textContent = result.data.user.email || "";

      message("Loading your dashboard…");

      const results = await Promise.allSettled([
        loadCatalogue(),
        loadOrders()
      ]);

      if (version !== authVersion) return;

      const failed = results.find((item) => item.status === "rejected");
      if (failed) throw failed.reason;

      message("");
    } catch (error) {
      if (version === authVersion) {
        message(errorText(error), true);
      }
    }
  }

  $("login-form").addEventListener("submit", (event) => {
    event.preventDefault();

    run($("login-button"), async () => {
      message("Signing in…");

      checked(await db.auth.signInWithPassword({
        email: $("login-email").value.trim(),
        password: $("login-password").value
      }));

      $("login-password").value = "";
      await checkSession();
    });
  });

  $("sign-out").addEventListener("click", () => {
    run($("sign-out"), async () => {
      checked(await db.auth.signOut({ scope: "local" }));
      signedOut();
      message("You have signed out.");
    });
  });

  db.auth.onAuthStateChange((event) => {
    if (event === "SIGNED_OUT") {
      signedOut();
    }

    if (event === "INITIAL_SESSION") {
      setTimeout(() => {
        checkSession();
      }, 0);
    }
  });

  document.querySelectorAll("[data-panel]").forEach((button) => {
    button.addEventListener("click", () => {
      document.querySelectorAll("[data-panel]").forEach((tab) => {
        tab.setAttribute("aria-pressed", String(tab === button));
      });

      document.querySelectorAll(".admin-panel").forEach((panel) => {
        panel.hidden = panel.id !== button.dataset.panel;
      });
    });
  });

  document.querySelectorAll("[data-close]").forEach((button) => {
    button.addEventListener("click", () => {
      $(button.dataset.close).close();
    });
  });

  $("product-dialog").addEventListener("close", resetPreview);

  $("product-search").addEventListener("input", renderProducts);
  $("product-category-filter").addEventListener("change", renderProducts);
  $("order-status-filter").addEventListener("change", renderOrders);
  $("product-image-file").addEventListener("change", updatePreview);
  $("product-image-url").addEventListener("input", updatePreview);

  function editProduct(product = null) {
    requireAdmin();

    if (!categories.length) {
      message("Add a category before adding your first product.", true);
      return;
    }

    $("product-form").reset();
    resetPreview();

    $("product-dialog-title").textContent =
      product ? "Edit product" : "Add product";

    $("product-id").value = product?.id || "";
    $("product-name").value = product?.name || "";
    $("product-category").value =
      product?.category_id || categories[0].id;
    $("product-description").value = product?.description || "";
    $("product-size").value = product?.size || "";
    $("product-price").value = product?.price ?? "";
    $("product-image-url").value = product?.image_url || "";
    $("product-sort").value = product?.sort_order ?? 0;
    $("product-active").checked = product?.active ?? true;

    updatePreview();
    $("product-dialog").showModal();
  }

  $("new-product").addEventListener("click", () => {
    try {
      editProduct();
    } catch (error) {
      message(errorText(error), true);
    }
  });

  $("products-table").addEventListener("click", (event) => {
    const button = event.target.closest("button[data-action]");
    if (!button) return;

    const product = products.find((item) => item.id === button.dataset.id);
    if (!product) return;

    if (button.dataset.action === "edit") {
      try {
        editProduct(product);
      } catch (error) {
        message(errorText(error), true);
      }
      return;
    }

    if (!confirm(`Delete "${product.name}" from the catalogue?`)) return;

    run(button, async () => {
      requireAdmin();

      const rows = checked(
        await db.from("egec_products")
          .delete()
          .eq("id", product.id)
          .select("id")
      );

      if (!rows.length) throw new Error("Product was not deleted.");

      await loadCatalogue();
      message("Product deleted. Existing order records are preserved.");
    });
  });

  $("product-form").addEventListener("submit", (event) => {
    event.preventDefault();

    run($("save-product"), async () => {
      requireAdmin();

      const id = $("product-id").value || crypto.randomUUID();
      const isEdit = Boolean($("product-id").value);
      const priceText = $("product-price").value.trim();
      const price = priceText === "" ? null : Number(priceText);
      const sort = Number($("product-sort").value);
      const name = $("product-name").value.trim();
      const rawUrl = $("product-image-url").value.trim();
      const file = $("product-image-file").files[0];

      if (!name) throw new Error("Enter a product name.");

      if (price !== null && (!Number.isFinite(price) || price < 0)) {
        throw new Error("Enter a valid price, or leave it blank.");
      }

      if (!Number.isInteger(sort) || Math.abs(sort) > 2147483647) {
        throw new Error("Display order must be a valid whole number.");
      }

      if (!file && rawUrl && !imageUrl(rawUrl)) {
        throw new Error("Use a site image path or a valid HTTPS image URL.");
      }

      const extensions = {
        "image/jpeg": "jpg",
        "image/png": "png",
        "image/webp": "webp"
      };

      if (file && (!extensions[file.type] || file.size > 5 * 1024 * 1024)) {
        throw new Error("Choose a JPEG, PNG or WebP image up to 5 MB.");
      }

      let uploadedPath = null;
      let saved = false;
      let photo = rawUrl || null;

      message("Saving product…");

      try {
        if (file) {
          uploadedPath =
            `${id}/${crypto.randomUUID()}.${extensions[file.type]}`;

          checked(await bucket.upload(uploadedPath, file, {
            contentType: file.type,
            cacheControl: "3600",
            upsert: false
          }));

          photo = bucket.getPublicUrl(uploadedPath).data.publicUrl;
        }

        const values = {
          name,
          category_id: $("product-category").value,
          description: $("product-description").value.trim(),
          size: $("product-size").value.trim(),
          price,
          currency: "XCD",
          image_url: photo,
          sort_order: sort,
          active: $("product-active").checked
        };

        const query = isEdit
          ? db.from("egec_products").update(values).eq("id", id)
          : db.from("egec_products").insert({ id, ...values });

        const rows = checked(await query.select("id"));
        if (!rows.length) throw new Error("Product was not saved.");

        saved = true;
        $("product-dialog").close();
        await loadCatalogue();
        message("Product saved.");
      } catch (error) {
        if (uploadedPath && !saved) {
          const cleanup = await bucket.remove([uploadedPath]);

          if (cleanup.error) {
            throw new Error(
              `${errorText(error)} The uploaded photo may remain in Storage.`
            );
          }
        }

        throw error;
      }
    });
  });

  function editCategory(category = null) {
    requireAdmin();

    $("category-form").reset();
    $("category-dialog-title").textContent =
      category ? "Edit category" : "Add category";

    $("category-id").value = category?.id || "";
    $("category-name").value = category?.name || "";
    $("category-sort").value = category?.sort_order ?? 0;
    $("category-active").checked = category?.active ?? true;
    $("category-dialog").showModal();
  }

  $("new-category").addEventListener("click", () => {
    try {
      editCategory();
    } catch (error) {
      message(errorText(error), true);
    }
  });

  $("categories-table").addEventListener("click", (event) => {
    const button = event.target.closest("button[data-action]");
    if (!button) return;

    const category = categories.find((item) => item.id === button.dataset.id);
    if (!category) return;

    if (button.dataset.action === "edit") {
      try {
        editCategory(category);
      } catch (error) {
        message(errorText(error), true);
      }
      return;
    }

    if (!confirm(`Delete the "${category.name}" category?`)) return;

    run(button, async () => {
      requireAdmin();

      const rows = checked(
        await db.from("egec_categories")
          .delete()
          .eq("id", category.id)
          .select("id")
      );

      if (!rows.length) throw new Error("Category was not deleted.");

      await loadCatalogue();
      message("Category deleted.");
    });
  });

  $("category-form").addEventListener("submit", (event) => {
    event.preventDefault();

    run($("save-category"), async () => {
      requireAdmin();

      const id = $("category-id").value;
      const name = $("category-name").value.trim();
      const sort = Number($("category-sort").value);

      if (!name) throw new Error("Enter a category name.");

      if (!Number.isInteger(sort) || Math.abs(sort) > 2147483647) {
        throw new Error("Display order must be a valid whole number.");
      }

      const values = {
        name,
        sort_order: sort,
        active: $("category-active").checked
      };

      const query = id
        ? db.from("egec_categories").update(values).eq("id", id)
        : db.from("egec_categories").insert(values);

      const rows = checked(await query.select("id"));
      if (!rows.length) throw new Error("Category was not saved.");

      $("category-dialog").close();
      await loadCatalogue();
      message("Category saved.");
    });
  });

  $("refresh-orders").addEventListener("click", () => {
    run($("refresh-orders"), async () => {
      requireAdmin();
      await loadOrders();
      message("Order requests refreshed.");
    });
  });

  $("orders-table").addEventListener("click", (event) => {
    const button = event.target.closest("button[data-action]");
    if (!button) return;

    const order = orders.find((item) => item.id === button.dataset.id);
    if (!order) return;

    run(button, async () => {
      requireAdmin();
      const version = authVersion;

      const items = checked(
        await db.from("egec_order_items")
          .select("*")
          .eq("order_id", order.id)
          .order("created_at")
      );

      if (version !== authVersion || !adminId) return;

      $("order-dialog-title").textContent = order.order_reference;

      $("order-details").innerHTML = `
        <p><strong>Customer:</strong>
          ${escapeHtml(order.customer_name)}</p>
        <p><strong>Email:</strong>
          ${escapeHtml(order.customer_email)}</p>
        <p><strong>Phone:</strong>
          ${escapeHtml(order.customer_phone)}</p>
        <p><strong>Fulfilment:</strong>
          ${escapeHtml(order.fulfilment_method)}</p>
        ${order.delivery_address ? `
          <p class="order-notes"><strong>Delivery address:</strong>
${escapeHtml(order.delivery_address)}</p>
        ` : ""}
        <h3>Selected products</h3>
        <ul>
          ${items.map((item) => `
            <li>
              <strong>${escapeHtml(item.product_name)}</strong>
              ${escapeHtml(item.product_size)}
              — ${escapeHtml(item.quantity)} units
              <br>
              Unit price: ${escapeHtml(money(item.unit_price))}
            </li>
          `).join("")}
        </ul>
        <p><strong>Estimated product total:</strong>
          ${escapeHtml(money(order.estimated_total))}</p>
        <p>Payment is arranged in person. Final pricing and fulfilment
          are confirmed by EGEC.</p>
        ${order.customer_notes ? `
          <p class="order-notes"><strong>Customer notes:</strong>
${escapeHtml(order.customer_notes)}</p>
        ` : ""}
      `;

      $("order-id").value = order.id;
      $("order-status").value = order.status;
      $("order-owner-notes").value = order.owner_notes || "";
      $("order-dialog").showModal();
    });
  });

  $("order-form").addEventListener("submit", (event) => {
    event.preventDefault();

    run($("save-order"), async () => {
      requireAdmin();

      const rows = checked(
        await db.from("egec_orders")
          .update({
            status: $("order-status").value,
            owner_notes: $("order-owner-notes").value.trim()
          })
          .eq("id", $("order-id").value)
          .select("id")
      );

      if (!rows.length) throw new Error("Order was not updated.");

      $("order-dialog").close();
      await loadOrders();
      message("Order updated. This action does not send an email.");
    });
  });
})();
