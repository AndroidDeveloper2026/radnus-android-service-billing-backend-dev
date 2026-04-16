const path = require("path");
const PDFDocument = require("pdfkit");

const logoPath = path.join(__dirname, "../assets/logo.png");

const generatePDF = (job, type = "estimate") => {
  console.log("-- data of (job) --",job)
  return new Promise((resolve) => {

    const doc = new PDFDocument({ size: "A4", margin: 40 });
    const buffers = [];
    doc.on("data", buffers.push.bind(buffers));
    doc.on("end", () => resolve(Buffer.concat(buffers)));

    const service = Number(job.service?.serviceCharge || 0);
    const spare   = Number(job.service?.spareCharge   || 0);
    const total   = service + spare;

    /* ─────────────────────────────────────────
       WATERMARK  –  centred diagonal, VISIBLE
    ───────────────────────────────────────── */
    doc.save();
    doc.rotate(-35, { origin: [297, 421] })
       .fontSize(110)
       .fillOpacity(0.15)  // Increased from 0.02 to 0.15 for visible watermark
       .fillColor("#000000")  // Changed back to black for visibility
       .font("Helvetica-Bold")
       .text("RADNUS", 0, 370, { width: 595, align: "center" });
    doc.restore();
    doc.fillOpacity(1).fillColor("#000");

    /* ─────────────────────────────────────────
       HEADER LEFT
    ───────────────────────────────────────── */
    doc.fontSize(14).font("Helvetica-Bold")
       .fillColor("#000")
       .text("RADNUS COMMUNICATION", 40, 40);

    doc.fontSize(9).font("Helvetica")
       .text("242, Sinnaya Plaza, MG Road,", 40, 56)
       .text("Puducherry - 605001",          40, 68)
       .text("Phone: 81222 73355",           40, 80)
       .text("Mon–Sat (10AM–7PM)",           40, 92)
       .text("Website: www.radnus.in",       40, 104);

    /* ─────────────────────────────────────────
       LOGO - CORRECTED POSITION
    ───────────────────────────────────────── */
    doc.image(logoPath, 260, 50, { width: 90 });

    /* ─────────────────────────────────────────
       HEADER RIGHT – JOB SHEET
    ───────────────────────────────────────── */
    const rX = 410;

    doc.fontSize(13).font("Helvetica-Bold")
     .text(type === "invoice" ? "INVOICE BILL" : "JOB SHEET", rX, 40);

    // Safe date formatter
    const fmtDate = (val) => {
      if (!val) return "";
      const s = String(val);
      if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
      const d = new Date(s);
      if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
      return s.slice(0, 10);
    };

    const jobRows = [
      ["Job No",   job.jobSheetNo              || ""],
      ["Created",  fmtDate(new Date())],
      ["Delivery", fmtDate(job.service?.deliveryDate)],
      ["Engineer", job.service?.engineer        || ""],
    ];

    const labelX = rX;
    const colonX = rX + 55;
    const valueX = rX + 65;
    const valueW = 555 - valueX;
    let jY = 58;

    jobRows.forEach(([label, value]) => {
      doc.fontSize(10).font("Helvetica-Bold").fillColor("#000")
         .text(label,  labelX, jY, { lineBreak: false });
      doc.font("Helvetica")
         .text(":",    colonX, jY, { lineBreak: false });
      doc.fontSize(10).font("Helvetica")
         .text(String(value), valueX, jY, { width: valueW, lineBreak: false });
      jY += 16;
    });

    /* ─────────────────────────────────────────
       HORIZONTAL RULE - THICKER
    ───────────────────────────────────────── */
    doc.moveTo(40, 138).lineTo(555, 138)
       .lineWidth(2).strokeColor("#000").stroke();

    /* ─────────────────────────────────────────
       SECTION TITLE HELPER
    ───────────────────────────────────────── */
    const sectionTitle = (text, x, y) => {
      doc.rect(x - 9, y + 1, 3.5, 15).fill("#000");
      doc.fillColor("#000").fontSize(11).font("Helvetica-Bold")
         .text(text, x, y, { lineBreak: false });
    };

    /* ─────────────────────────────────────────
       CUSTOMER  &  DEVICE
    ───────────────────────────────────────── */
    let secY = 150;
    sectionTitle("CUSTOMER", 40,  secY);
    sectionTitle("DEVICE",   305, secY);

    const boxTop = secY + 18;
    const boxH   = 85;

    // Customer box - WHITE with border
    doc.roundedRect(40, boxTop, 250, boxH, 4)
       .fillAndStroke("#ffffff", "#cccccc");
    doc.fillColor("#000").fontSize(9.5).font("Helvetica")
       .text(`Name: ${job.customer?.name      || ""}`, 50, boxTop + 10, { width: 225 })
       .text(`Phone: ${job.customer?.contact   || ""}`,                { width: 225 })
       .text(`Email: ${job.customer?.email     || ""}`,                { width: 225 })
       .text(`Address: ${job.customer?.address  || ""}`,               { width: 225 });

    // Device box - WHITE with border
    doc.roundedRect(305, boxTop, 250, boxH, 4)
       .fillAndStroke("#ffffff", "#cccccc");
    doc.fillColor("#000").fontSize(9.5).font("Helvetica")
       .text(`Brand: ${job.device?.make  || ""}`, 315, boxTop + 10, { width: 225 })
       .text(`Model: ${job.device?.model || ""}`,                 { width: 225 })
       .text(`IMEI: ${job.device?.imei   || ""}`,                 { width: 225 });

    /* ─────────────────────────────────────────
       ISSUE
    ───────────────────────────────────────── */
    let iy = boxTop + boxH + 12;
    sectionTitle("ISSUE", 40, iy);
    iy += 18;

    // Combine visualIssues and physicalCondition arrays
    const issueText = [
      ...(job.visualIssues || []),
      ...(job.physicalCondition || [])
    ].filter(Boolean).join(", ");

    doc.roundedRect(40, iy, 515, 50, 4)
       .fillAndStroke("#ffffff", "#cccccc");
    doc.fillColor("#000").fontSize(9.5).font("Helvetica")
       .text(issueText || "", 50, iy + 12, { width: 495 });

    /* ─────────────────────────────────────────
       MOBILE CONDITION  –  table (NO HEADER ROW)
    ───────────────────────────────────────── */
    let mc = iy + 62;
    sectionTitle("MOBILE CONDITION", 40, mc);
    mc += 18;

    const cond    = job.physicalCondition || {};
    const COL     = [110, 140, 130, 135];   // col widths, total = 515
    const TX      = 40;
    const RH      = 28;

    // DATA ROWS ONLY - NO HEADER ROW
    const condRows = [
      ["Charger",     cond.charger    ? "Yes" : (cond.charger === "" ? "" : "No"), "Pattern / PIN", job.device?.pattern  || ""],
      ["Back",        cond.back       ? "Yes" : (cond.back === "" ? "" : "No"),     "Memory Card",   cond.memoryCard ? "Yes" : (cond.memoryCard === "" ? "" : "No")],
      ["SIM",         cond.sim        ? "Yes" : (cond.sim === "" ? "" : "No"),      "",              ""],
    ];

    // Draw data rows with alternating colors
    condRows.forEach((row, ri) => {
      const ry = mc + RH * ri;
      const bg = ri % 2 === 0 ? "#e8e8e8" : "#ffffff";
      doc.rect(TX, ry, 515, RH).fillAndStroke(bg, "#999999");
      let cx = TX;
      row.forEach((cell, ci) => {
        doc.fillColor("#000").fontSize(9.5)
           .font(ci % 2 === 0 ? "Helvetica-Bold" : "Helvetica")
           .text(cell, cx + 7, ry + 7, { width: COL[ci] - 8, lineBreak: false });
        cx += COL[ci];
      });
    });

    /* ─────────────────────────────────────────
       ESTIMATE AMOUNT - WITH BREAKDOWN
    ───────────────────────────────────────── */
    let ey = mc + RH * condRows.length + 14;
    sectionTitle(type === "invoice" ? "INVOICE AMOUNT" : "ESTIMATE AMOUNT", 40, ey);
    ey += 18;

    // Dashed border box
    doc.dash(5, { space: 4 })
       .rect(40, ey, 515, 85)
       .stroke("#666666");
    doc.undash();

    // Service Charge row
    doc.fillColor("#000").fontSize(11).font("Helvetica-Bold")
       .text("Service Charge", 50, ey + 10, { width: 400, lineBreak: false });
    doc.fontSize(11).font("Helvetica-Bold").fillColor("#000")
       .text(`${service || ""}`, 480, ey + 10, { width: 65, align: "right", lineBreak: false });

    // Spare Charge row
    doc.fillColor("#000").fontSize(11).font("Helvetica-Bold")
       .text("Spare Charge", 50, ey + 32, { width: 400, lineBreak: false });
    doc.fontSize(11).font("Helvetica-Bold").fillColor("#000")
       .text(`${spare || ""}`, 480, ey + 32, { width: 65, align: "right", lineBreak: false });

    // Divider line
    doc.moveTo(50, ey + 52).lineTo(540, ey + 52)
       .lineWidth(1).strokeColor("#999999").stroke();

    // Total Estimate row
    doc.fillColor("#000").fontSize(12).font("Helvetica-Bold")
       .text(type === "invoice" ? "Total Invoice" : "Total Estimate", 50, ey + 58, { width: 400, lineBreak: false });
    doc.fontSize(12).font("Helvetica-Bold").fillColor("#000")
       .text(`${total || ""}`, 480, ey + 58, { width: 65, align: "right", lineBreak: false });

    /* ─────────────────────────────────────────
       TERMS & CONDITIONS
    ───────────────────────────────────────── */
    let ty = ey + 99;
    sectionTitle("TERMS & CONDITIONS", 40, ty);
    ty += 16;

    const terms = [
      "Replaced parts will not be returned.",
      "Data may be lost during repair/software upgradation.",
      "Company bears no responsibility, whatsoever if equipment is not collected within 45 days from the date of receipt.",
      "Please make sure that you have removed your SIM card and/or memory card from your phone. Gadget Hub does not accept responsibility for loss of these items.",
      "No delivery will be made without the customer's copy of the job order.",
      "Company bears no responsibility, if any fault occurs on additional fault findings while servicing on booked complaints.",
      "Only checking warranty for all services and spares used.",
    ];

    const termsBoxY = ty;
    let termY = ty + 10;

    // Measure text height first
    doc.save();
    terms.forEach((t, i) => {
      doc.fillColor("#000").fontSize(8.5).font("Helvetica")
         .text(`${i + 1}. ${t}`, 54, termY, { width: 490 });
      termY = doc.y + 3;
    });
    const termsBoxH = termY - termsBoxY + 6;
    doc.restore();

    // Draw the box
    doc.roundedRect(40, termsBoxY, 515, termsBoxH, 4)
       .fillAndStroke("#fafafa", "#cccccc");

    // Re-draw text on top
    termY = termsBoxY + 10;
    terms.forEach((t, i) => {
      doc.fillColor("#000").fontSize(8.5).font("Helvetica")
         .text(`${i + 1}. ${t}`, 54, termY, { width: 490 });
      termY = doc.y + 3;
    });

    /* ─────────────────────────────────────────
       SIGNATURES
    ───────────────────────────────────────── */
    // const signY = termY + 20;

    // doc.lineWidth(1).strokeColor("#000");
    // doc.moveTo(50,  signY).lineTo(175, signY).stroke();
    // doc.moveTo(225, signY).lineTo(370, signY).stroke();
    // doc.moveTo(415, signY).lineTo(555, signY).stroke();

    // doc.fontSize(8.5).font("Helvetica").fillColor("#000")
    //    .text("Customer Signature", 55,  signY + 5, { lineBreak: false })
    //    .text("For RADNUS",         255, signY + 5, { lineBreak: false })
    //    .text("Authorized Signatory", 420, signY + 5, { lineBreak: false });

    doc.end();
  });
};

module.exports = generatePDF;