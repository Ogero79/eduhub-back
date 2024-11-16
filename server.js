require('dotenv').config();
const express = require("express");
const cors = require("cors");
const session = require("express-session");
const pg = require("pg");
const bcrypt = require("bcryptjs");
const path = require("path");
const app = express();
const multer = require("multer");
const router = express.Router();
const PORT = 5000;

// Initialize database pool
const pool = new pg.Pool({
  user: process.env.DB_USER,
  host: process.env.DB_HOST,
  database: process.env.DB_DATABASE,
  password: process.env.DB_PASSWORD,
  port: process.env.DB_PORT,
});

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const allowedOrigins = [
  process.env.FRONTEND_URL_DEV,
  process.env.FRONTEND_URL_PROD,
  process.env.FRONTEND_URL_STAGING,
];

app.use(
  cors({
    origin: function (origin, callback) {
      // Check if the origin is in the allowed list
      if (allowedOrigins.includes(origin) || !origin) {
        callback(null, true);  // Allow the request
      } else {
        callback(new Error('Not allowed by CORS'), false); // Reject the request
      }
    },
    methods: ["GET", "POST", "DELETE", "PUT", "PATCH"],
    credentials: true,
  })
);

const isProduction = process.env.NODE_ENV === 'production'; 

app.use(
  session({
    secret: process.env.SECRET_KEY, // Session secret key
    resave: false,
    saveUninitialized: true,
    cookie: {
      httpOnly: true, // Prevent access via JavaScript
      secure: isProduction, // Set to true for HTTPS (in production)
    },
  })
);
// Logout route to destroy session
app.post("/logout", (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      return res.status(500).send({ message: "Error logging out." });
    }
    res.clearCookie("connect.sid"); // Remove the session cookie
    res.status(200).send({ message: "Logged out successfully" });
  });
});

// Configure Multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, "./uploads"); // Change this path as per your preference
  },
  filename: (req, file, cb) => {
    cb(null, file.originalname);

  },
});

const upload = multer({ storage });

// Create a resource route

app.post("/admin/add-resource", upload.single("file"), async (req, res) => {
  const { title, description, year, semester, course, unitCode, resourceType } =
    req.body;
  const fileUrl = req.file ? req.file.path : null; // If file exists, get its path
  const fileType = path.extname(req.file.originalname).substring(1);

  try {
    // Insert the resource into the database
    await pool.query(
      "INSERT INTO resources (title, description, year, semester, course, unitcode, filetype, resource_type, file_url) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)",
      [
        title,
        description,
        year,
        semester,
        course,
        unitCode,
        fileType,
        resourceType,
        fileUrl,
      ]
    );
    res.json({ message: "Resource added successfully!" });
  } catch (err) {
    console.error("Error adding resource:", err);
    res.status(500).json({ message: "Error adding resource" });
  }
});

app.post("/classrep/add-resource", upload.single("file"), async (req, res) => {
  const { title, description, year, semester, course, unitCode, resourceType } =
    req.body;
  const fileUrl = req.file ? req.file.path : null; // If file exists, get its path
  const fileType = path.extname(req.file.originalname).substring(1);

  try {
    // Insert the resource into the database
    await pool.query(
      "INSERT INTO resources (title, description, year, semester, course, unitcode, filetype, resource_type, file_url) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)",
      [
        title,
        description,
        year,
        semester,
        course,
        unitCode,
        fileType,
        resourceType,
        fileUrl,
      ]
    );
    res.json({ message: "Resource added successfully!" });
  } catch (err) {
    console.error("Error adding resource:", err);
    res.status(500).json({ message: "Error adding resource" });
  }
});

// Register Route
app.post("/register", async (req, res) => {
  const {
    email,
    password,
    first_name,
    last_name,
    year,
    semester,
    course,
    gender,
  } = req.body;

  try {
    // Check if the email already exists
    const result = await pool.query("SELECT * FROM students WHERE email = $1", [
      email,
    ]);
    if (result.rows.length > 0) {
      return res.status(400).json({ message: "Email already in use" });
    }

    // Hash the password before storing it
    const hashedPassword = await bcrypt.hash(password, 10);

    // Insert the new student into the database, including the course
    const insertQuery = `
      INSERT INTO students (email, password, first_name, last_name, year, semester, course, gender)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING id, email, first_name, last_name, course;
    `;
    const insertResult = await pool.query(insertQuery, [
      email,
      hashedPassword,
      first_name,
      last_name,
      year,
      semester,
      course,
      gender,
    ]);

    const newUser = insertResult.rows[0];
    res.status(201).json({ message: "Registration successful", user: newUser });
  } catch (err) {
    console.error("Error registering user:", err);
    res.status(500).json({ message: "Error registering user" });
  }
});

// Serve static files in production (e.g., React build)
app.use(express.static(path.join(__dirname, "build")));

// Hardcoded superadmin credentials (you can change these)
const superAdminCredentials = {
  email: "superadmin@gmail.com",
  password: "superadmin", // Replace with a real password in production
};

// Login Route
app.post("/login", async (req, res) => {
  const { email, password } = req.body;

  try {
    // Validate input
    if (!email || !password) {
      return res.status(400).json({ error: "Email and password are required" });
    }

    // Check if login is for superadmin
    if (
      email === superAdminCredentials.email &&
      password === superAdminCredentials.password
    ) {
      req.session.userId = email; // Store superadmin session
      req.session.role = "superadmin"; // Superadmin role
      return res.json({
        message: "Login successful",
        redirectTo: "/superadmin",
      });
    }

    // Check if it's a classRep
    const classRepResult = await pool.query(
      "SELECT * FROM class_representatives WHERE email = $1",
      [email]
    );
    if (classRepResult.rows.length > 0) {
      const classRep = classRepResult.rows[0];
      const isClassRepPasswordValid = await bcrypt.compare(
        password,
        classRep.password
      );

      if (isClassRepPasswordValid) {
        req.session.userId = classRep.id;
        req.session.firstName = classRep.first_name;
        req.session.lastName = classRep.last_name;
        req.session.role = "classRep";
        req.session.course = classRep.course;
        req.session.email = classRep.email;
        req.session.year = classRep.year;
        req.session.semester = classRep.semester;
        return res.json({
          message: "Login successful",
          redirectTo: "/classrep/dashboard",
        });
      } else {
        return res.status(401).json({ error: "Invalid email or password" });
      }
    }

    // Check if it's an admin
    const adminResult = await pool.query(
      "SELECT * FROM admins WHERE email = $1",
      [email]
    );
    if (adminResult.rows.length > 0) {
      const admin = adminResult.rows[0];
      const isAdminPasswordValid = await bcrypt.compare(
        password,
        admin.password
      );

      if (isAdminPasswordValid) {
        req.session.userId = admin.id;
        req.session.firstName = admin.first_name;
        req.session.lastName = admin.last_name;
        req.session.email = admin.email;
    
        req.session.role = "admin";
        return res.json({
          message: "Login successful",
          redirectTo: "/admin/dashboard",
        });
      } else {
        return res.status(401).json({ error: "Invalid email or password" });
      }
    }

    // Check if it's a student
    const studentResult = await pool.query(
      "SELECT * FROM students WHERE email = $1",
      [email]
    );
    if (studentResult.rows.length > 0) {
      const student = studentResult.rows[0];
      const isStudentPasswordValid = await bcrypt.compare(
        password,
        student.password
      );

      if (isStudentPasswordValid) {
        req.session.userId = student.id;
        req.session.role = "student";
        req.session.firstName = student.first_name;
        req.session.lastName = student.last_name;
        req.session.email = student.email;
        req.session.course = student.course;
        req.session.year = student.year;
        req.session.semester = student.semester;

        return res.json({
          message: "Login successful",
          redirectTo: "/dashboard",
        });
      } else {
        return res.status(401).json({ error: "Invalid email or password" });
      }
    }

    // If no user found in any role
    return res.status(404).json({ error: "User not found" });
  } catch (err) {
    console.error("Error during login:", err);
    return res
      .status(500)
      .json({ error: "An error occurred. Please try again later." });
  }
});

// Create Admin Route
app.post("/superadmin/create-admin", async (req, res) => {
  const { firstName, lastName, email, password } = req.body;

  // Validate input
  if (!firstName || !lastName || !email || !password) {
    return res.status(400).json({ message: "All fields are required" });
  }

  try {
    // Check if the admin already exists by email
    const result = await pool.query("SELECT * FROM admins WHERE email = $1", [
      email,
    ]);
    if (result.rows.length > 0) {
      return res
        .status(400)
        .json({ message: "Admin with this email already exists" });
    }

    // Hash the password before storing it in the database
    const hashedPassword = await bcrypt.hash(password, 10);

    // Insert the new admin into the database
    await pool.query(
      "INSERT INTO admins (first_name, last_name, email, password) VALUES ($1, $2, $3, $4)",
      [firstName, lastName, email, hashedPassword]
    );

    res.json({ message: "Admin created successfully" });
  } catch (err) {
    console.error("Error creating admin:", err);
    res.status(500).json({ message: "Error creating admin" });
  }
});

// Add Class Representative Route
app.post("/superadmin/create-class-rep", async (req, res) => {
  const { first_name, last_name, email, year, semester, password, course } =
    req.body;

  try {
    // Hash the password before saving it to the database
    const hashedPassword = await bcrypt.hash(password, 10);

    // Insert class representative data into the class_representatives table
    const result = await pool.query(
      "INSERT INTO class_representatives (first_name, last_name, email, year, semester, password, course) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *",
      [first_name, last_name, email, year, semester, hashedPassword, course]
    );

    // Send a success response with the created class rep data
    res.json({
      message: "Class Representative added successfully",
      classRep: result.rows[0],
    });
  } catch (err) {
    console.error("Error adding class representative: ", err);
    res.status(500).json({ message: "Error adding class representative" });
  }
});

// Generic Role Check Route
app.get("/user/check", (req, res) => {
  const { role } = req.session; // Extract role from session
  if (["admin", "superadmin", "classRep", "student"].includes(role)) {
    return res.json({ role }); // Return the role if valid
  } else {
    return res.status(403).json({ message: "Forbidden" }); // Return 403 if role is invalid
  }
});

// Normal User Dashboard Route (Protected)
app.get("/dashboard", (req, res) => {
  if (req.session.role !== "student") {
    return res
      .status(403)
      .json({ message: "Access denied. You are not logged in as a student." });
  }
  res.json({
    message: `Welcome to the student dashboard, ${req.session.firstName}!`,
  });
});

// Super Admin Dashboard Route (Protected)
app.get("/superadmin/dashboard", (req, res) => {
  if (req.session.role !== "superadmin") {
    return res
      .status(403)
      .json({ message: "Access denied. You are not a superadmin." });
  }
  res.json({ message: "Welcome to the Super Admin Dashboard!" });
});

// Normal User Dashboard Route (Protected)
app.get("/dashboard", (req, res) => {
  if (req.session.year !== "student") {
    return res
      .status(403)
      .json({ message: "Access denied. You are not logged in as a student." });
  }
  res.json({
    message: `Welcome to the student dashboard, ${req.session.firstName}!`,
  });
});

// Normal User Dashboard Route (Protected)
app.get("/classrep/dashboard", (req, res) => {
  if (req.session.role !== "classRep") {
    return res
      .status(403)
      .json({
        message: "Access denied. You are not logged in as a class REP.",
      });
  }
  res.json({
    message: `Welcome to the class rep dashboard, ${req.session.firstName}!`,
  });
});
// Normal User Dashboard Route (Protected)
app.get("/admin/dashboard", (req, res) => {
  if (req.session.role !== "admin") {
    return res
      .status(403)
      .json({ message: "Access denied. You are not logged in as an admin." });
  }
  res.json({
    message: `Welcome to the admin dashboard, ${req.session.firstName}!`,
  });
});

// Get list of admins
app.get("/superadmin/admins", async (req, res) => {
  try {
    const totalAdminsResult = await pool.query("SELECT COUNT(*) FROM admins");
    const totalAdmins = totalAdminsResult.rows[0].count;

    const result = await pool.query("SELECT * FROM admins ORDER BY id DESC");
    res.json({ totalAdmins, admins: result.rows });
  } catch (err) {
    console.error("Error fetching admins:", err);
    res.status(500).json({ message: "Error fetching admins" });
  }
});

// Get list of class representatives
app.get("/superadmin/classreps", async (req, res) => {
  try {
    const totalClassRepsResult = await pool.query(
      "SELECT COUNT(*) FROM class_representatives"
    );
    const totalClassReps = totalClassRepsResult.rows[0].count;

    const result = await pool.query(
      "SELECT * FROM class_representatives ORDER BY id DESC"
    );
    res.json({ totalClassReps, classReps: result.rows });
  } catch (err) {
    console.error("Error fetching class representatives:", err);
    res.status(500).json({ message: "Error fetching class representatives" });
  }
});

// Get list of students
app.get("/superadmin/students", async (req, res) => {
  try {
    const totalStudentsResult = await pool.query(
      "SELECT COUNT(*) FROM students"
    );
    const totalStudents = totalStudentsResult.rows[0].count;

    const totalFemaleStudentsResult = await pool.query(
      "SELECT COUNT(*) FROM students WHERE gender = $1",
      ["Female"]
    );
    const totalFemaleStudents = totalFemaleStudentsResult.rows[0].count;

    const totalMaleStudentsResult = await pool.query(
      "SELECT COUNT(*) FROM students WHERE gender = $1",
      ["Male"]
    );
    const totalMaleStudents = totalMaleStudentsResult.rows[0].count;

    const result = await pool.query("SELECT * FROM students ORDER BY id DESC");
    res.json({
      totalStudents,
      totalFemaleStudents,
      totalMaleStudents,
      students: result.rows,
    });
  } catch (err) {
    console.error("Error fetching students:", err);
    res.status(500).json({ message: "students" });
  }
});

// SuperAdmin Route to fetch total resources and list all resources
app.get("/superadmin/resources", async (req, res) => {
  try {
    // Query to get the total number of resources
    const totalResourcesResult = await pool.query(
      "SELECT COUNT(*) FROM resources"
    );
    const totalResources = totalResourcesResult.rows[0].count;

    // Query to get all resources
    const resourcesResult = await pool.query(
      "SELECT * FROM resources ORDER BY created_at DESC"
    );
    const resources = resourcesResult.rows;

    // Send both the total count and the list of resources to the frontend
    res.json({
      totalResources,
      resources,
    });
  } catch (err) {
    console.error("Error fetching resources:", err);
    res.status(500).json({ message: "Error fetching resources" });
  }
});

app.get("/student/recent-resources", async (req, res) => {
  const year = req.session.year;
  const course = req.session.course;
  const semester = req.session.semester;

  try {
    // Query to get all resources
    const resourcesResult = await pool.query(
      "SELECT * FROM resources WHERE course = $1 AND year = $2 AND semester = $3 ORDER BY created_at DESC LIMIT 4",
      [course, year, semester]
    );
    const resources = resourcesResult.rows;

    // Send the list of resources to the frontend
    res.json({ resources });
  } catch (err) {
    console.error("Error fetching resources:", err);
    res.status(500).json({ message: "Error fetching resources" });
  }
});
// Route to fetch user data based on the session
app.get("/user/profile", (req, res) => {
  // Retrieve user data from session
  const firstName = req.session.firstName;
  const lastName = req.session.lastName;
  const email = req.session.email;
  const course = req.session.course;
  const year = req.session.year;
  const semester = req.session.semester;
  const role = req.session.role;

  try {
    // Return the session data as a response
    res.json({
      firstName,
      lastName,
      email,
      course,
      year,
      semester,
      role,
    });
  } catch (err) {
    console.error("Error fetching user data:", err);
    res.status(500).json({ message: "Error fetching user data" });
  }
});


// Route to update user profile
app.put("/user/profile", async (req, res) => {
  const { email, role } = req.session; // User's email and role from session
  const { firstName, lastName, course, year, semester } = req.body;

  if (!email) {
    return res.status(401).json({ message: "User not logged in" });
  }

  // Map roles to their corresponding tables and update logic
  const roleConfig = {
    student: {
      table: "students",
      columns: "first_name = $1, last_name = $2, course = $3, year = $4, semester = $5",
      values: [firstName, lastName, course, year, semester, email],
    },
    classRep: {
      table: "class_representatives",
      columns: "first_name = $1, last_name = $2, course = $3, year = $4, semester = $5",
      values: [firstName, lastName, course, year, semester, email],
    },
    admin: {
      table: "admins",
      columns: "first_name = $1, last_name = $2",
      values: [firstName, lastName, email], // Admins might not need course/year/semester
    },
  };

  const config = roleConfig[role];
  if (!config) {
    return res.status(403).json({ message: "Unauthorized role" });
  }

  try {
    const query = `
      UPDATE ${config.table}
      SET ${config.columns}
      WHERE email = $${config.values.length}
      RETURNING *;
    `;

    const result = await pool.query(query, config.values);

    if (result.rowCount === 0) {
      return res.status(404).json({ message: "User not found" });
    }

    // Update session with new data
    req.session.firstName = firstName;
    req.session.lastName = lastName;

    if (role !== "admin") {
      req.session.course = course;
      req.session.year = year;
      req.session.semester = semester;
    }

    res.json({ message: "Profile updated successfully", user: result.rows[0] });
  } catch (err) {
    console.error("Error updating profile:", err);
    res.status(500).json({ message: "Error updating profile" });
  }
});


app.get("/student/notes-resources", async (req, res) => {
  const year = req.session.year;
  const course = req.session.course;
  const semester = req.session.semester;
  try {
    // Query to get all resources
    const resourcesResult = await pool.query(
      "SELECT * FROM resources WHERE resource_type = $1 AND course = $2 AND year = $3 AND semester = $4 ORDER BY created_at DESC LIMIT 4",
      ["Notes", course, year, semester]
    );

    const resources = resourcesResult.rows;

    // Send both the total count and the list of resources to the frontend
    res.json({
      resources,
    });
  } catch (err) {
    console.error("Error fetching resources:", err);
    res.status(500).json({ message: "Error fetching resources" });
  }
});

app.get("/student/all-notes-resources", async (req, res) => {
  const year = req.session.year;
  const course = req.session.course;
  const semester = req.session.semester;
  try {
    // Query to get all resources
    const resourcesResult = await pool.query(
      "SELECT * FROM resources WHERE resource_type = $1 AND course = $2 AND year = $3 AND semester = $4 ORDER BY created_at DESC",
      ["Notes", course, year, semester]
    );

    const resources = resourcesResult.rows;

    // Send both the total count and the list of resources to the frontend
    res.json({
      resources,
    });
  } catch (err) {
    console.error("Error fetching resources:", err);
    res.status(500).json({ message: "Error fetching resources" });
  }
});

app.get("/student/all-papers-resources", async (req, res) => {
  const year = req.session.year;
  const course = req.session.course;
  const semester = req.session.semester;
  try {
    // Query to get all resources
    const resourcesResult = await pool.query(
      "SELECT * FROM resources WHERE resource_type = $1 AND course = $2 AND year = $3 AND semester = $4 ORDER BY created_at DESC",
      ["Past Paper", course, year, semester]
    );

    const resources = resourcesResult.rows;

    // Send both the total count and the list of resources to the frontend
    res.json({
      resources,
    });
  } catch (err) {
    console.error("Error fetching resources:", err);
    res.status(500).json({ message: "Error fetching resources" });
  }
});

app.get("/student/all-tasks-resources", async (req, res) => {
  const year = req.session.year;
  const course = req.session.course;
  const semester = req.session.semester;
  try {
    // Query to get all resources
    const resourcesResult = await pool.query(
      "SELECT * FROM resources WHERE resource_type = $1 AND course = $2 AND year = $3 AND semester = $4 ORDER BY created_at DESC",
      ["Task", course, year, semester]
    );

    const resources = resourcesResult.rows;

    // Send both the total count and the list of resources to the frontend
    res.json({
      resources,
    });
  } catch (err) {
    console.error("Error fetching resources:", err);
    res.status(500).json({ message: "Error fetching resources" });
  }
});

app.get("/student/papers-resources", async (req, res) => {
  try {
    const course = req.session.course;
    const year = req.session.year;
    const semester = req.session.semester;

    // Ensure session variables are defined
    if (!course || !year || !semester) {
      return res.status(400).json({ message: "Missing session data" });
    }

    // Query with additional filters
    const resourcesResult = await pool.query(
      "SELECT * FROM resources WHERE resource_type = $1 AND course = $2 AND year = $3 AND semester = $4 ORDER BY created_at DESC LIMIT 4",
      ["Past Paper", course, year, semester]
    );

    const resources = resourcesResult.rows;

    res.json({ resources });
  } catch (err) {
    console.error("Error fetching resources:", err);
    res.status(500).json({ message: "Error fetching resources" });
  }
});

app.get("/student/tasks-resources", async (req, res) => {
  try {
    // Query to get all resources
    const year = req.session.year;
    const course = req.session.course;
    const semester = req.session.semester;

    const resourcesResult = await pool.query(
      "SELECT * FROM resources WHERE resource_type = $1 AND course = $2 AND year = $3 AND semester = $4 ORDER BY created_at DESC LIMIT 4",
      ["Task", course, year, semester]
    );

    const resources = resourcesResult.rows;

    // Send both the total count and the list of resources to the frontend
    res.json({
      resources,
    });
  } catch (err) {
    console.error("Error fetching resources:", err);
    res.status(500).json({ message: "Error fetching resources" });
  }
});

app.get("/resource-adder/check", (req, res) => {
  if (req.session.role === "admin") {
    return res.json({ role: "admin" }); // If superadmin, return role as 'admin'
  } else if (req.session.role === "classRep") {
    const { course, year, semester } = req.session; // Extract course, year, and semester from session
    return res.json({
      role: "classRep",
      course,
      year,
      semester,
    });
  } else {
    return res.status(403).json({ message: "Forbidden" }); // Return 403 if not authorized
  }
});

// SuperAdmin Route to delete a class rep
app.delete("/superadmin/classreps/:id", async (req, res) => {
  const classRepId = req.params.id;

  try {
    // Query to delete the class rep by his ID
    const deleteResult = await pool.query(
      "DELETE FROM class_representatives WHERE id = $1 RETURNING *",
      [classRepId]
    );

    // If no class rep was deleted, return an error
    if (deleteResult.rows.length === 0) {
      return res.status(404).json({ message: "Class Rep not found" });
    }

    // Send a success response
    res.json({ message: "Class Rep deleted successfully" });
  } catch (err) {
    console.error("Error deleting class rep:", err);
    res.status(500).json({ message: "Error deleting class rep" });
  }
});

// SuperAdmin Route to delete a student
app.delete("/superadmin/students/:id", async (req, res) => {
  const studentId = req.params.id;

  try {
    // Query to delete the class rep by his ID
    const deleteResult = await pool.query(
      "DELETE FROM students WHERE id = $1 RETURNING *",
      [studentId]
    );

    // If no class rep was deleted, return an error
    if (deleteResult.rows.length === 0) {
      return res.status(404).json({ message: "Student not found" });
    }

    // Send a success response
    res.json({ message: "Student deleted successfully" });
  } catch (err) {
    console.error("Error deleting Student:", err);
    res.status(500).json({ message: "Error deleting Student" });
  }
});

// SuperAdmin Route to delete an admin
app.delete("/superadmin/admins/:id", async (req, res) => {
  const adminId = req.params.id;

  try {
    // Query to delete the class rep by his ID
    const deleteResult = await pool.query(
      "DELETE FROM admins WHERE id = $1 RETURNING *",
      [adminId]
    );

    // If no class rep was deleted, return an error
    if (deleteResult.rows.length === 0) {
      return res.status(404).json({ message: "Admin not found" });
    }

    // Send a success response
    res.json({ message: "Admin deleted successfully" });
  } catch (err) {
    console.error("Error deleting Admin:", err);
    res.status(500).json({ message: "Error deleting Admin" });
  }
});

// SuperAdmin Route to delete a resource
app.delete("/superadmin/resources/:id", async (req, res) => {
  const resourceId = req.params.id;

  try {
    // Query to delete the resource by its ID
    const deleteResult = await pool.query(
      "DELETE FROM resources WHERE id = $1 RETURNING *",
      [resourceId]
    );

    // If no resource was deleted, return an error
    if (deleteResult.rows.length === 0) {
      return res.status(404).json({ message: "Resource not found" });
    }

    // Send a success response
    res.json({ message: "Resource deleted successfully" });
  } catch (err) {
    console.error("Error deleting resource:", err);
    res.status(500).json({ message: "Error deleting resource" });
  }
});

// Start the server
app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server is running on port ${PORT}`);
});
