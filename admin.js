const readline = require('readline');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const db = new sqlite3.Database(path.join(__dirname, 'marengo.db'));

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

const command = process.argv[2];

if (command === 'add') {
  rl.question('License Key: ', (key) => {
    rl.question('Organization: ', (organization) => {
      rl.question('License Type (Full/Lite): ', (type) => {
        rl.question('Expiry Date (YYYY-MM-DD): ', (expiry) => {
          rl.question('Products (comma-separated): ', (products) => {
            rl.question('Support Email: ', (email) => {
              db.run(
                `INSERT INTO licenses (key, organization, license_type, expiry, products, support_email)
                 VALUES (?, ?, ?, ?, ?, ?)`,
                [key.trim(), organization, type, expiry, products, email],
                (err) => {
                  if (err) {
                    console.error('❌ Failed to add license:', err.message);
                  } else {
                    console.log('✅ License added successfully.');
                  }
                  rl.close();
                }
              );
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
    db.run("DELETE FROM licenses WHERE key = ?", [keyToRemove], function(err) {
      if (err) {
        console.error('❌ Error deleting license:', err.message);
      } else if (this.changes === 0) {
        console.warn('⚠️ No license found with that key.');
      } else {
        console.log('✅ License removed successfully.');
      }
      rl.close();
    });
  }

} else {
  console.log("Usage:");
  console.log("  node admin.js add      → Add a new license");
  console.log("  node admin.js list     → List all licenses");
  console.log("  node admin.js remove <LICENSE_KEY> → Remove license");
  rl.close();
}
