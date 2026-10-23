/* --------------------------------------------------
   TIKTOK FOLLOWERS, LIKES AND VIEWS ORDERS
-------------------------------------------------- */

app.post("/api/orders", requireCustomer, (req, res) => {
  try {
    const platform = cleanString(req.body.platform, 30);
    const service = cleanString(req.body.service, 40);
    const country = cleanString(req.body.country, 50);
    const profileLink = cleanString(req.body.profileLink, 500);

    if (
      platform !== "TikTok" ||
      !["Followers", "Likes", "Views"].includes(service)
    ) {
      return res.status(400).json({
        error: "Unsupported platform or service."
      });
    }

    if (!country) {
      return res.status(400).json({
        error: "Please select a country or package."
      });
    }

    let profileUrl;

    try {
      profileUrl = new URL(profileLink);
    } catch {
      return res.status(400).json({
        error: "Enter a valid TikTok profile link."
      });
    }

    if (
      profileUrl.protocol !== "https:" ||
      !/(^|\.)tiktok\.com$/i.test(profileUrl.hostname) ||
      !/^\/@[\w.-]+\/?$/.test(profileUrl.pathname)
    ) {
      return res.status(400).json({
        error: "Enter a valid TikTok profile URL."
      });
    }

    let quantity;
    let price;

    if (service === "Followers") {
      const isMix = country.toLowerCase() === "all mix";
      quantity = isMix ? 3000 : 1000;
      price = isMix ? 250 : 100;
    } else if (service === "Likes") {
      const packageName = country.trim().toLowerCase();

      if (["mix", "mix likes"].includes(packageName)) {
        quantity = 1000;
        price = 150;
      } else if (
        ["all in one", "all in one likes"].includes(packageName)
      ) {
        quantity = 1000;
        price = 50;
      } else {
        return res.status(400).json({
          error: "Select Mix Likes or All in One Likes."
        });
      }
    } else {
      // TikTok Views: 1,000 views = Rs. 20
      quantity = 1000;
      price = 20;
    }

    const db = readDb();

    const customer = db.customers.find(
      item => String(item.id) === String(req.session.customerId)
    );

    if (!customer || customer.status !== "approved") {
      return res.status(403).json({
        error: "Your account is not approved."
      });
    }

    if (!Array.isArray(db.orders)) db.orders = [];

    if (!Number.isInteger(db.nextOrderId)) {
      db.nextOrderId =
        db.orders.reduce(
          (max, order) =>
            Math.max(max, Number(order.id) || 0),
          0
        ) + 1;
    }

    const order = {
      id: db.nextOrderId++,
      customerId: customer.id,
      customerName: customer.name,
      username: customer.username,
      platform: "TikTok",
      service,
      country,
      profileLink: profileUrl.href,
      quantity,
      price,
      status: "pending",
      createdAt: new Date().toISOString()
    };

    db.orders.push(order);
    writeDb(db);

    return res.status(201).json({
      message: `Your TikTok ${service} request has been submitted and is awaiting review.`,
      order: {
        id: order.id,
        platform: order.platform,
        service: order.service,
        country: order.country,
        quantity: order.quantity,
        price: order.price,
        status: order.status,
        createdAt: order.createdAt
      }
    });
  } catch (error) {
    console.error("TikTok order error:", error.message);
    return res.status(500).json({
      error: "Could not submit the order. Please try again."
    });
  }
});
