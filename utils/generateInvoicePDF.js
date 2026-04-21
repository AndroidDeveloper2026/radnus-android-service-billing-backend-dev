const path = require("path");
const PDFDocument = require("pdfkit");

const logo = path.join(__dirname, "../assets/logo.png");
const tamilFont = path.join(__dirname, "../assets/NotoSansTamil-Regular.ttf");

const generateInvoicePDF = (job) => {

  return new Promise((resolve) => {

    const doc = new PDFDocument({
      size: "A4",
      margin: 0
    });

    const buffers = [];
    doc.on("data", buffers.push.bind(buffers));
    doc.on("end", () => resolve(Buffer.concat(buffers)));

    const service = Number(job.service?.serviceCharge || 0);
    const spare = Number(job.service?.spareCharge || 0);
    const total = service + spare;

    const paymentLabel =
      job.service?.paymentMode === "Cash" ? "CASH MEMO" :
      job.service?.paymentMode === "UPI"  ? "UPI BILL"  :
      job.service?.paymentMode === "Card" ? "CARD BILL" :
      "BILL";

    // ─── Color Palette ────────────────────────────────────────────────────────
    const BRAND_DARK   = "#1a1a2e";   // deep navy
    const BRAND_ACCENT = "#e94560";   // vivid red accent
    const BRAND_MID    = "#16213e";   // mid navy for subheader bar
    const LIGHT_BG     = "#f8f9fc";   // very light grey page bg tint
    const TABLE_HEAD   = "#1a1a2e";   // table header bg
    const TABLE_ALT    = "#f0f4ff";   // alternating row tint
    const TEXT_DARK    = "#1a1a2e";
    const TEXT_MID     = "#444466";
    const TEXT_LIGHT   = "#ffffff";
    const BORDER       = "#dde3f0";
    const ACCENT_LINE  = "#e94560";

    const PW = 595.28;  // A4 width
    const PH = 841.89;  // A4 height
    const ML = 40;      // margin left
    const MR = 40;      // margin right
    const CW = PW - ML - MR; // content width

    /* ═══════════════════════════════════════════════════════════════════════
       WATERMARK
    ═══════════════════════════════════════════════════════════════════════ */
    doc.save();
    doc.rotate(-35, { origin: [297, 421] });
    doc.fontSize(120).fillOpacity(0.04).fillColor(BRAND_DARK).text("RADNUS", 0, 380, { align: "center" });
    doc.restore();
    doc.fillOpacity(1);

    /* ═══════════════════════════════════════════════════════════════════════
       TOP HEADER BAND — dark navy full-width
    ═══════════════════════════════════════════════════════════════════════ */
    doc.rect(0, 0, PW, 90).fill(BRAND_DARK);

    // Accent left stripe
    doc.rect(0, 0, 5, 90).fill(BRAND_ACCENT);

    // Logo (white area behind logo for visibility)
    try {
      doc.image(logo, ML + 5, 15, { width: 70, height: 60 });
    } catch (e) { /* logo optional */ }

    // Company name & address — right of logo
    doc.fillColor(TEXT_LIGHT).font("Helvetica-Bold").fontSize(17)
       .text("RADNUS COMMUNICATION", ML + 85, 22, { width: 260 });
    doc.fillColor("#aab4cc").font("Helvetica").fontSize(8.5)
       .text("242, Sinnaya Plaza, MG Road, Puducherry - 605001", ML + 85, 44, { width: 260 });

    // Contact info — right side of header
    const ri = PW - MR - 165;
    doc.fillColor(BRAND_ACCENT).font("Helvetica-Bold").fontSize(7.5)
       .text("PH :", ri, 22, { width: 22, lineBreak: false });
    doc.fillColor("#aab4cc").font("Helvetica").fontSize(7.5)
       .text("81222 73355 / 99409 73030", ri + 24, 22, { width: 141 });

    doc.fillColor(BRAND_ACCENT).font("Helvetica-Bold").fontSize(7.5)
       .text("EM :", ri, 37, { width: 22, lineBreak: false });
    doc.fillColor("#aab4cc").font("Helvetica").fontSize(7.5)
       .text("radnus@gmail.com", ri + 24, 37, { width: 141 });

    doc.fillColor(BRAND_ACCENT).font("Helvetica-Bold").fontSize(7.5)
       .text("TM :", ri, 52, { width: 22, lineBreak: false });
    doc.fillColor("#aab4cc").font("Helvetica").fontSize(7.5)
       .text("10 AM to 7 PM", ri + 24, 52, { width: 141 });

    /* ═══════════════════════════════════════════════════════════════════════
       SUBHEADER BAR — payment label + bill type badge
    ═══════════════════════════════════════════════════════════════════════ */
    doc.rect(0, 90, PW, 28).fill(BRAND_MID);

    doc.fillColor(TEXT_LIGHT).font("Helvetica-Bold").fontSize(10)
       .text(paymentLabel, ML + 5, 98);

    /* ═══════════════════════════════════════════════════════════════════════
       CUSTOMER & BILL INFO PANEL
    ═══════════════════════════════════════════════════════════════════════ */
    const infoY = 128;
    const infoH = 62;

    // Left panel — customer
    doc.rect(ML, infoY, CW * 0.58, infoH).fillAndStroke(LIGHT_BG, BORDER);
    // Right panel — bill details
    doc.rect(ML + CW * 0.58 + 4, infoY, CW * 0.42 - 4, infoH).fillAndStroke(LIGHT_BG, BORDER);

    // Customer section header strip
    doc.rect(ML, infoY, CW * 0.58, 16).fill("#e8ecf8");
    doc.fillColor(TEXT_MID).font("Helvetica-Bold").fontSize(7.5)
       .text("CUSTOMER DETAILS", ML + 8, infoY + 4);

    // Bill info section header strip
    const rp = ML + CW * 0.58 + 4;
    doc.rect(rp, infoY, CW * 0.42 - 4, 16).fill("#e8ecf8");
    doc.fillColor(TEXT_MID).font("Helvetica-Bold").fontSize(7.5)
       .text("BILL DETAILS", rp + 8, infoY + 4);

    // Customer data
    doc.font("Helvetica-Bold").fontSize(9).fillColor(TEXT_DARK);
    const cy = infoY + 22;
    doc.text("Customer :", ML + 8, cy).text("Contact  :", ML + 8, cy + 13).text("Address  :", ML + 8, cy + 26);

    doc.font("Helvetica").fontSize(9).fillColor(TEXT_MID);
    doc.text(job.customer?.name    || "—", ML + 65, cy,      { width: CW * 0.58 - 75 });
    doc.text(job.customer?.contact || "—", ML + 65, cy + 13, { width: CW * 0.58 - 75 });
    doc.text(job.customer?.address || "—", ML + 65, cy + 26, { width: CW * 0.58 - 75 });

    // Bill data
    doc.font("Helvetica-Bold").fontSize(9).fillColor(TEXT_DARK);
    doc.text("Bill No  :", rp + 8, cy).text("Bill Date:", rp + 8, cy + 13);

    doc.font("Helvetica").fontSize(9).fillColor(TEXT_MID);
    doc.text(job.jobSheetNo || "—",               rp + 60, cy);
    doc.text(new Date().toLocaleDateString(),      rp + 60, cy + 13);

    /* ═══════════════════════════════════════════════════════════════════════
       TABLE
    ═══════════════════════════════════════════════════════════════════════ */
    const tableY = infoY + infoH + 14;

    // Column definitions
    const cols = [
      { key: "make",    label: "MAKE",    x: ML,       w: 70  },
      { key: "model",   label: "MODEL",   x: ML + 70,  w: 100 },
      { key: "imei",    label: "IMEI",    x: ML + 170, w: 105 },
      { key: "fault",   label: "FAULT",   x: ML + 275, w: 130 },
      { key: "service", label: "SERVICE", x: ML + 405, w: 65  },
      { key: "spare",   label: "SPARE",   x: ML + 470, w: 45  },
    ];

    const headerH = 24;

    // Header bg
    doc.rect(ML, tableY, CW, headerH).fill(TABLE_HEAD);

    // Accent top border on header
    doc.rect(ML, tableY, CW, 3).fill(BRAND_ACCENT);

    // Header text
    doc.fillColor(TEXT_LIGHT).font("Helvetica-Bold").fontSize(8.5);
    cols.forEach(c => {
      doc.text(c.label, c.x + 5, tableY + 8, { width: c.w - 8, align: "center" });
    });

    // Data row height calculation
    const faultText   = (job.visualIssues || []).join(", ") || "-";
    const faultWidth  = 120;
    const charsPerLine = Math.floor(faultWidth / 6.2);
    const faultLines  = Math.ceil(faultText.length / charsPerLine);
    const dataRowH    = Math.max(30, faultLines * 14 + 12);

    const rowY = tableY + headerH;

    // Row background
    doc.rect(ML, rowY, CW, dataRowH).fill(TABLE_ALT);

    // Row bottom border
    doc.rect(ML, rowY + dataRowH - 1, CW, 1).fill(BORDER);

    // Vertical dividers between columns
    doc.strokeColor(BORDER).lineWidth(1);
    cols.slice(1).forEach(c => {
      doc.moveTo(c.x, tableY).lineTo(c.x, rowY + dataRowH).stroke();
    });

    // Outer border of the whole table
    doc.rect(ML, tableY, CW, headerH + dataRowH).stroke(BORDER);

    // Row data
    doc.font("Helvetica").fontSize(9).fillColor(TEXT_DARK);
    const ry = rowY + 8;

    doc.text(job.device?.make  || "-", cols[0].x + 5, ry, { width: cols[0].w - 8, align: "center", lineBreak: false });
    doc.text(job.device?.model || "-", cols[1].x + 5, ry, { width: cols[1].w - 8, align: "center", lineBreak: false });
    doc.font("Helvetica").fontSize(8)
       .text(job.device?.imei  || "-", cols[2].x + 5, ry, { width: cols[2].w - 8, align: "center", lineBreak: false });

    doc.font("Helvetica").fontSize(8.5).fillColor(TEXT_MID)
       .text(faultText, cols[3].x + 5, rowY + 6, { width: cols[3].w - 8, lineBreak: true });

    // Charges with Tamil font for ₹
    doc.font(tamilFont).fontSize(9).fillColor(BRAND_ACCENT);
    doc.text(`₹ ${service}`, cols[4].x + 5, ry, { width: cols[4].w - 8, align: "center", lineBreak: false });
    doc.text(`₹ ${spare}`,   cols[5].x + 2, ry, { width: cols[5].w - 4, align: "center", lineBreak: false });

    /* ═══════════════════════════════════════════════════════════════════════
       TOTALS PANEL
    ═══════════════════════════════════════════════════════════════════════ */
    const totalBoxY = rowY + dataRowH + 10;
    const totalBoxW = 180;
    const totalBoxX = PW - MR - totalBoxW;

    doc.rect(totalBoxX, totalBoxY, totalBoxW, 46).fillAndStroke(LIGHT_BG, BORDER);

    // Sub total row
    doc.rect(totalBoxX, totalBoxY, totalBoxW, 23).fill("#edf0f8");
    doc.font("Helvetica").fontSize(9).fillColor(TEXT_MID)
       .text("Sub Total", totalBoxX + 10, totalBoxY + 7, { width: 90 });
    doc.font(tamilFont).fontSize(9).fillColor(TEXT_DARK)
       .text(`₹ ${total}`, totalBoxX + 100, totalBoxY + 7, { width: 70, align: "right" });

    // Grand total row
    doc.rect(totalBoxX, totalBoxY + 23, totalBoxW, 23).fill(BRAND_DARK);
    doc.font("Helvetica-Bold").fontSize(9).fillColor(TEXT_LIGHT)
       .text("Grand Total", totalBoxX + 10, totalBoxY + 30, { width: 90 });
    doc.font(tamilFont).fontSize(9).fillColor(BRAND_ACCENT)
       .text(`₹ ${total.toFixed(2)}`, totalBoxX + 100, totalBoxY + 30, { width: 70, align: "right" });

    /* ═══════════════════════════════════════════════════════════════════════
       REMARKS
    ═══════════════════════════════════════════════════════════════════════ */
    let nextY = totalBoxY + 60;

    if (job.service?.remarks) {
      // Section label
      doc.rect(ML, nextY, 4, 16).fill(BRAND_ACCENT);
      doc.font("Helvetica-Bold").fontSize(9.5).fillColor(TEXT_DARK)
         .text("REMARKS", ML + 10, nextY + 2);
      nextY += 20;

      doc.rect(ML, nextY, CW, 1).fill(BORDER);
      nextY += 8;

      doc.font("Helvetica").fontSize(9).fillColor(TEXT_MID)
         .text(job.service.remarks, ML + 6, nextY, { width: CW - 12 });
      nextY = doc.y + 18;
    }

    /* ═══════════════════════════════════════════════════════════════════════
       TERMS & CONDITIONS — English
    ═══════════════════════════════════════════════════════════════════════ */
    // Section header
    doc.rect(ML, nextY, 4, 16).fill(BRAND_ACCENT);
    doc.font("Helvetica-Bold").fontSize(9.5).fillColor(TEXT_DARK)
       .text("TERMS & CONDITIONS", ML + 10, nextY + 2);
    nextY += 22;

    doc.rect(ML, nextY, CW, 1).fill(BORDER);
    nextY += 8;

    const terms = [
      "Replaced parts will not be returned.",
      "Data may be lost during repair/software upgradation.",
      "Company bears no responsibility if equipment is not collected within 45 days.",
      "Please remove your SIM card and memory card before handing over the device.",
      "No delivery will be made without the customer's copy of the job order.",
      "Company bears no responsibility for faults found during servicing.",
      "Only checking warranty for all services and spares used."
    ];

    doc.font("Helvetica").fontSize(8.5).fillColor(TEXT_MID);
    terms.forEach((t, i) => {
      // Alternate tint for readability
      if (i % 2 === 0) {
        const lineHEst = 13;
        doc.rect(ML, nextY - 2, CW, lineHEst).fill("#f5f7fd");
      }
      doc.fillColor(BRAND_ACCENT).text(`${i + 1}.`, ML + 4, nextY, { width: 14, lineBreak: false });
      doc.fillColor(TEXT_MID).text(t, ML + 18, nextY, { width: CW - 22 });
      nextY = doc.y + 4;
    });

    nextY += 8;

    /* ═══════════════════════════════════════════════════════════════════════
       TERMS — Tamil
    ═══════════════════════════════════════════════════════════════════════ */
    doc.rect(ML, nextY, 4, 16).fill(BRAND_ACCENT);
    doc.font(tamilFont).fontSize(9.5).fillColor(TEXT_DARK)
       .text("விதிமுறைகள்", ML + 10, nextY + 2);
    nextY += 22;

    doc.rect(ML, nextY, CW, 1).fill(BORDER);
    nextY += 8;

    const tamil = [
      "மாற்றப்பட்ட உதிரிப்பாகங்கள் திருப்பி வழங்கப்படமாட்டாது.",
      "பழுது பார்க்கும்போது / சாப்ட்வேர் அப்டேட் செய்யும் போது தகவல்கள் இழக்க நேரிடலாம்.",
      "பெறப்பட்ட நாளிலிருந்து 45 நாட்களுக்குள் பொருள் பெறப்படாவிட்டால் நிறுவனம் பொறுப்பல்ல.",
      "தயவுசெய்து உங்கள் சிம் கார்டு மற்றும் மெமரி கார்டை அகற்றி வழங்கவும்.",
      "வேலை ஒப்பந்த நகல் இல்லாமல் பொருள் வழங்கப்படமாட்டாது.",
      "சரிசெய்யும் போது புதிய குறைகள் ஏற்பட்டால் நிறுவனம் பொறுப்பல்ல.",
      "சேவை மற்றும் உதிரிப்பாகங்களுக்கு மட்டுமே உத்தரவாதம் வழங்கப்படும்."
    ];

    doc.font(tamilFont).fontSize(8.5).fillColor(TEXT_MID);
    tamil.forEach((t, i) => {
      if (i % 2 === 0) {
        const lineHEst = 13;
        doc.rect(ML, nextY - 2, CW, lineHEst).fill("#f5f7fd");
      }
      doc.fillColor(BRAND_ACCENT).font(tamilFont).fontSize(8.5)
         .text(`${i + 1}.`, ML + 4, nextY, { width: 14, lineBreak: false });
      doc.fillColor(TEXT_MID).text(t, ML + 18, nextY, { width: CW - 22 });
      nextY = doc.y + 4;
    });

    /* ═══════════════════════════════════════════════════════════════════════
       FOOTER BAR
    ═══════════════════════════════════════════════════════════════════════ */
    const footerY = PH - 50;

    doc.rect(0, footerY, PW, 50).fill(BRAND_DARK);
    doc.rect(0, footerY, PW, 3).fill(BRAND_ACCENT);

    // Signature
    doc.font("Helvetica").fontSize(8.5).fillColor("#aab4cc")
       .text("Authorized Signature", PW - MR - 130, footerY + 10, { width: 120, align: "center" });
    // Signature line
    doc.moveTo(PW - MR - 120, footerY + 26).lineTo(PW - MR - 10, footerY + 26)
       .strokeColor("#aab4cc").lineWidth(0.5).stroke();

    // Footer left note
    doc.font("Helvetica").fontSize(7.5).fillColor("#6677aa")
       .text("Thank you for choosing Radnus Communication!", ML, footerY + 18, { width: 250 });

    doc.end();
  });
};

module.exports = generateInvoicePDF;