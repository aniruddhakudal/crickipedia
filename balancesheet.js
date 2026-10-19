(function () {
  var C = window.Crickipedia;
  var tournamentRef = null;

  function qs(id) {
    return document.getElementById(id);
  }

  function tournamentRefFromQuery() {
    var tournament = C.queryParam("tournament");
    var season = C.queryParam("season");
    var slug = C.queryParam("t");
    if (tournament && season) return { tournament: tournament, season: season };
    if (slug) return { slug: slug };
    return null;
  }

  function initBackLink() {
    var ref = tournamentRefFromQuery();
    var back = qs("backLink");
    if (!ref) {
      back.href = "/";
      return;
    }
    if (ref.tournament && ref.season) {
      back.href = "/" + encodeURIComponent(ref.tournament) + "/" + encodeURIComponent(ref.season);
      back.textContent = "← Back to tournament";
    } else if (ref.slug) {
      back.href = C.publicUrl({ slug: ref.slug });
      back.textContent = "← Back to tournament";
    }
  }

  function openAttachmentModal(src, title, meta) {
    qs("attachmentModalTitle").textContent = title || "Attachment";
    var metaEl = qs("attachmentModalMeta");
    if (meta) {
      metaEl.textContent = meta;
      metaEl.classList.remove("hidden");
    } else {
      metaEl.textContent = "";
      metaEl.classList.add("hidden");
    }
    qs("attachmentModalImg").src = src;
    qs("attachmentModal").style.display = "flex";
  }

  function closeAttachmentModal() {
    qs("attachmentModal").style.display = "none";
    qs("attachmentModalImg").removeAttribute("src");
  }

  function render(data, ref) {
    var t = data.tournament || {};
    qs("pageTitle").textContent = (t.name || "Tournament") + " — Balance Sheet";
    document.title = (t.name || "Balance Sheet") + " — Crickipedia";
    var s = data.summary || {};
    qs("sumCredits").textContent = C.formatMoney(s.credits);
    qs("sumDebits").textContent = C.formatMoney(s.debits);
    qs("sumBalance").textContent = C.formatMoney(s.balance);
    var body = qs("ledgerBody");
    var entries = data.entries || [];
    if (!entries.length) {
      body.innerHTML = '<tr><td colspan="5" class="muted">No entries yet.</td></tr>';
      return;
    }
    body.innerHTML = entries.map(function (row) {
      var amtClass = row.type === "debit" ? "amount-debit" : "amount-credit";
      var sign = row.type === "debit" ? "−" : "+";
      var receipt = "";
      if (row.hasAttachment) {
        var label = row.source === "registration" ? "View receipt" : "View bill";
        receipt =
          '<button type="button" class="receipt-link" data-view-attachment="' + C.escapeHtml(row.id) + '"' +
          ' data-attachment-label="' + C.escapeHtml(label) + '"' +
          ' data-attachment-title="' + C.escapeHtml(row.description || label) + '">' +
          C.escapeHtml(label) + "</button>";
      } else if (row.source === "registration" && row.paymentGateway === "RAZORPAY") {
        receipt = '<span class="muted">Paid online</span>';
      } else {
        receipt = '<span class="muted">—</span>';
      }
      return "<tr>" +
        "<td>" + C.escapeHtml(C.formatPrettyDate(row.occurredAt) || "") + "</td>" +
        "<td>" + C.escapeHtml(row.description) + "</td>" +
        "<td>" + C.escapeHtml(
          row.source === "registration_reversal" ? "Reversal" :
            (row.type === "debit" ? "Expense" : "Credit")
        ) + "</td>" +
        '<td class="' + amtClass + '">' + sign + " " + C.escapeHtml(C.formatMoney(row.amount)) + "</td>" +
        "<td>" + receipt + "</td>" +
        "</tr>";
    }).join("");
  }

  function boot() {
    C.initUiThemeToggle();
    initBackLink();
    tournamentRef = tournamentRefFromQuery();
    if (!tournamentRef) {
      qs("loadError").textContent = "Add ?tournament=…&season=… or ?t=… to the URL.";
      qs("loadError").classList.remove("hidden");
      return;
    }

    qs("closeAttachmentModal").addEventListener("click", closeAttachmentModal);
    qs("attachmentModal").addEventListener("click", function (event) {
      if (event.target.id === "attachmentModal") closeAttachmentModal();
    });
    document.addEventListener("keydown", function (event) {
      if (event.key === "Escape") closeAttachmentModal();
    });

    qs("ledgerBody").addEventListener("click", function (event) {
      var btn = event.target.closest("[data-view-attachment]");
      if (!btn || !tournamentRef) return;
      var entryId = btn.getAttribute("data-view-attachment");
      var title = btn.getAttribute("data-attachment-title") || "Attachment";
      var label = btn.getAttribute("data-attachment-label") || "Attachment";
      var src = C.api.ledgerAttachmentUrl(tournamentRef, entryId);
      openAttachmentModal(src, title, label === "View receipt" ? "" : label);
    });

    C.api.ledger(tournamentRef).then(function (data) {
      render(data, tournamentRef);
    }).catch(function (err) {
      qs("loadError").textContent = err.message || "Could not load Balance Sheet";
      qs("loadError").classList.remove("hidden");
    });
  }

  boot();
})();
