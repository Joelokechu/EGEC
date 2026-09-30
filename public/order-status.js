(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const config = window.EGEC_CONFIG;

  let loading = false;
  let hasLoaded = false;

  const statuses = {
    new: {
      label: "Request received",
      title: "We have received your request.",
      description:
        "EGEC will review your selection and contact you to confirm " +
        "availability, pricing and collection or delivery."
    },

    confirmed: {
      label: "Confirmed",
      title: "Your order has been confirmed.",
      description:
        "EGEC has marked your request as confirmed. Please follow the " +
        "collection or delivery arrangements agreed with our team."
    },

    ready: {
      label: "Ready",
      title: "Your order is ready.",
      description:
        "EGEC has marked your order as ready. Contact our team if you " +
        "need to confirm collection or delivery arrangements."
    },

    completed: {
      label: "Completed",
      title: "Your order has been marked complete.",
      description:
        "Thank you for choosing Eze Green Energy Company. " +
        "Contact our team if you have any questions about this order."
    },

    cancelled: {
      label: "Cancelled",
      title: "This order has been cancelled.",
      description:
        "This request is no longer proceeding. Contact EGEC and quote " +
        "your reference if you would like more information."
    }
  };

  const escapeHtml = (value) =>
    String(value ?? "").replace(/[&<>"']/g, (character) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;"
    })[character]);

  function money(value) {
    if (value === null || value === undefined) {
      return "To be confirmed";
    }

    const amount = Number(value);

    return Number.isFinite(amount)
      ? `EC$ ${amount.toFixed(2)}`
      : "To be confirmed";
  }

  function formatDate(value) {
    const date = new Date(value);

    if (Number.isNaN(date.getTime())) {
      return "Not available";
    }

    return new Intl.DateTimeFormat("en-GB", {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: "America/St_Lucia"
    }).format(date) + " · Saint Lucia";
  }

  function getToken() {
    const parameters = new URLSearchParams(
      window.location.hash.replace(/^#/, "")
    );

    const token = parameters.get("token") || "";

    return /^[0-9a-f]{64}$/.test(token) ? token : "";
  }

  function showMessage(message, focus = false) {
    $("status-message").textContent = message;
    $("status-message").hidden = false;

    if (focus) {
      $("status-message").focus();
    }
  }

  function showUnavailable() {
    $("order-card").hidden = true;
    hasLoaded = false;

    showMessage(
      "This order is no longer available, or its private link is invalid. " +
      "Please contact EGEC if you need assistance.",
      true
    );
  }

  function renderOrder(order) {
    const status = statuses[order.status] || {
      label: "Update available",
      title: "Please contact EGEC.",
      description:
        "Our team can help you confirm the latest details of your request."
    };

    $("order-reference").textContent = order.reference;
    $("order-date").textContent =
      `Requested ${formatDate(order.created_at)}`;

    $("status-badge").textContent = status.label;
    $("status-badge").dataset.status =
      Object.hasOwn(statuses, order.status) ? order.status : "";

    $("status-title").textContent = status.title;
    $("status-description").textContent = status.description;

    $("order-fulfilment").textContent =
      order.fulfilment_method === "delivery"
        ? "Delivery requested"
        : "Collection";

    $("order-updated").textContent =
      formatDate(order.updated_at);

    const items = Array.isArray(order.items) ? order.items : [];

    $("order-items").innerHTML = items.length
      ? items.map((item) => `
          <tr>
            <td>
              <strong>${escapeHtml(item.product_name)}</strong>
              ${item.product_size
                ? `<small>${escapeHtml(item.product_size)}</small>`
                : ""}
            </td>

            <td>${escapeHtml(item.quantity)}</td>
            <td>${escapeHtml(money(item.unit_price))}</td>
            <td>${escapeHtml(money(item.line_total))}</td>
          </tr>
        `).join("")
      : `
          <tr>
            <td colspan="4">
              Contact EGEC to confirm the product selection.
            </td>
          </tr>
        `;

    $("order-total").textContent =
      order.estimated_total === null ||
      order.estimated_total === undefined
        ? "Total price to be confirmed by EGEC"
        : `Estimated product total: ${money(order.estimated_total)}`;

    $("last-checked").textContent =
      `Status checked ${formatDate(new Date().toISOString())}`;

    $("status-message").hidden = true;
    $("order-card").hidden = false;
    hasLoaded = true;
  }

  async function loadOrder() {
    if (loading) return;

    const token = getToken();

    if (!token) {
      showUnavailable();
      return;
    }

    if (!config?.supabaseUrl || !config?.supabasePublishableKey) {
      showMessage(
        "Order tracking is temporarily unavailable. Please contact EGEC.",
        true
      );
      return;
    }

    loading = true;
    $("refresh-order").disabled = true;
    $("refresh-order").textContent = "Checking…";
    $("order-card").setAttribute("aria-busy", "true");

    if (!hasLoaded) {
      showMessage("Loading your order…");
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);

    try {
      const root = config.supabaseUrl.replace(/\/+$/, "");

      const response = await fetch(
        `${root}/rest/v1/rpc/egec_get_order_status`,
        {
          method: "POST",
          headers: {
            apikey: config.supabasePublishableKey,
            "Content-Type": "application/json",
            Accept: "application/json"
          },
          body: JSON.stringify({ p_token: token }),
          cache: "no-store",
          signal: controller.signal
        }
      );

      if (!response.ok) {
        throw new Error("Order tracking unavailable.");
      }

      const order = await response.json();

      if (order === null) {
        showUnavailable();
        return;
      }

      if (
        !order ||
        typeof order !== "object" ||
        typeof order.reference !== "string" ||
        !/^EGEC-[0-9]+$/.test(order.reference)
      ) {
        throw new Error("Unexpected order response.");
      }

      renderOrder(order);
    } catch {
      showMessage(
        hasLoaded
          ? "We couldn’t refresh the status. The details below are from " +
            "the previous check. Please try again."
          : "We couldn’t load your order. Please refresh this page, " +
            "or contact EGEC for assistance.",
        true
      );
    } finally {
      clearTimeout(timer);
      loading = false;
      $("refresh-order").disabled = false;
      $("refresh-order").textContent = "Refresh status";
      $("order-card").setAttribute("aria-busy", "false");
    }
  }

  $("refresh-order").addEventListener("click", loadOrder);

  $("print-order").addEventListener("click", () => {
    if (hasLoaded) {
      window.print();
    }
  });

  window.addEventListener("hashchange", () => {
    if (loading) {
      // Reload so an earlier request cannot display another token's order.
      window.location.reload();
      return;
    }

    hasLoaded = false;
    $("order-card").hidden = true;
    loadOrder();
  });

  $("year").textContent = String(new Date().getFullYear());

  loadOrder();
})();
