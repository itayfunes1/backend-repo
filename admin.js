const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const readline = require('readline');

// Database setup
const db = new sqlite3.Database(path.join(__dirname, 'marengo.db'));
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

// License key generator
function generateLicenseKey() {
  const segment = () =>
    Math.random().toString(36).replace(/[^a-z0-9]/gi, '').substring(0, 4).toUpperCase();
  return `MNGO-${segment()}-${segment()}-${segment()}`;
}

const command = process.argv[2];

if (command === 'add') {
  const licenseKey = generateLicenseKey();
  console.log(`🔐 Generated License Key: ${licenseKey}`);

  rl.question("🏢 Organization Name: ", (organization) => {
    rl.question("🔑 License Type (e.g., Full, Trial): ", (licenseType) => {
      rl.question("📦 Products (comma-separated, e.g., GUI,CLI,DOC): ", (products) => {
        rl.question("📅 Expiry Date (dd/mm/yyyy): ", (expiry) => {
          rl.question("📧 Support Email: ", (supportEmail) => {
            const query = `
              INSERT INTO licenses (key, organization, license_type, products, expiry, support_email)
              VALUES (?, ?, ?, ?, ?, ?)
            `;
            db.run(query, [licenseKey, organization, licenseType, products, expiry, supportEmail], function (err) {
              if (err) {
                console.error('❌ Failed to insert license:', err.message);
              } else {
                console.log(`✅ License inserted successfully: ${licenseKey}`);
              }
              rl.close();
            });
          });
        });
      });
    });
  });

} else if (command === 'list') {
  db.all("SELECT * FROM licenses", [], (err, rows) => {
    if (err) {
      console.error('❌ Failed to fetch licenses:', err.message);
    } else {
      console.table(rows);
    }
    rl.close();
  });

} else if (command === 'remove') {
  const keyToRemove = process.argv[3];
  if (!keyToRemove) {
    console.error('❌ Please provide a license key to remove.');
    rl.close();
  } else {
    db.run("DELETE FROM licenses WHERE key = ?", [keyToRemove], function (err) {
      if (err) {
        console.error('❌ Error deleting license:', err.message);
      } else if (this.changes === 0) {
        console.warn('⚠ No license found with that key.');
      } else {
        console.log('✅ License removed successfully.');
      }
      rl.close();
    });
  }

} else {
  console.log("Usage:");
  console.log("  node admin.js add                     → Add a new license");
  console.log("  node admin.js list                    → List all licenses");
  console.log("  node admin.js remove <LICENSE_KEY>   → Remove license");
  rl.close();
}
