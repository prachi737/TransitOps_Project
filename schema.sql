-- schema.sql
-- TransitOps — MySQL schema
-- Run once to create the database and tables:
--   mysql -u root -p < schema.sql

CREATE DATABASE IF NOT EXISTS transitops
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE transitops;

-- ---------------------------------------------------------------
-- USERS
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
  id            INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  email         VARCHAR(190) NOT NULL,
  name          VARCHAR(190) NOT NULL,
  role          ENUM('fleet_manager','driver','safety_officer','financial_analyst') NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  created_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_users_email (email)
) ENGINE=InnoDB;

-- ---------------------------------------------------------------
-- VEHICLES
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS vehicles (
  id                INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  reg_number        VARCHAR(50) NOT NULL,
  name              VARCHAR(190) NOT NULL,
  type              VARCHAR(100) NOT NULL,
  max_load          DECIMAL(10,2) NOT NULL DEFAULT 0,
  odometer          DECIMAL(12,2) NOT NULL DEFAULT 0,
  acquisition_cost  DECIMAL(12,2) NOT NULL DEFAULT 0,
  status            ENUM('Available','On Trip','In Shop','Retired') NOT NULL DEFAULT 'Available',
  region            VARCHAR(100) NULL,
  created_at        TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_vehicles_reg_number (reg_number),
  KEY idx_vehicles_status (status)
) ENGINE=InnoDB;

-- ---------------------------------------------------------------
-- DRIVERS
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS drivers (
  id               INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name             VARCHAR(190) NOT NULL,
  license_number   VARCHAR(50) NOT NULL,
  license_category VARCHAR(50) NOT NULL,
  license_expiry   DATE NOT NULL,
  contact_number   VARCHAR(30) NOT NULL,
  safety_score     INT NOT NULL DEFAULT 100,
  status           ENUM('Available','On Trip','Suspended') NOT NULL DEFAULT 'Available',
  created_at       TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_drivers_license_number (license_number),
  KEY idx_drivers_status (status),
  KEY idx_drivers_license_expiry (license_expiry)
) ENGINE=InnoDB;

-- ---------------------------------------------------------------
-- TRIPS
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS trips (
  id               INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  source           VARCHAR(190) NOT NULL,
  destination      VARCHAR(190) NOT NULL,
  vehicle_id       INT UNSIGNED NOT NULL,
  driver_id        INT UNSIGNED NOT NULL,
  cargo_weight     DECIMAL(10,2) NOT NULL,
  planned_distance DECIMAL(10,2) NOT NULL,
  status           ENUM('Draft','Dispatched','Completed','Cancelled') NOT NULL DEFAULT 'Draft',
  final_odometer   DECIMAL(12,2) NULL,
  fuel_consumed    DECIMAL(10,2) NULL,
  revenue          DECIMAL(12,2) NULL,
  created_at       TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_trips_vehicle FOREIGN KEY (vehicle_id) REFERENCES vehicles(id),
  CONSTRAINT fk_trips_driver  FOREIGN KEY (driver_id)  REFERENCES drivers(id),
  KEY idx_trips_status (status),
  KEY idx_trips_vehicle_id (vehicle_id),
  KEY idx_trips_driver_id (driver_id)
) ENGINE=InnoDB;

-- ---------------------------------------------------------------
-- MAINTENANCE LOGS
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS maintenance_logs (
  id           INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  vehicle_id   INT UNSIGNED NOT NULL,
  description  VARCHAR(500) NOT NULL,
  cost         DECIMAL(12,2) NOT NULL DEFAULT 0,
  date         DATE NOT NULL,
  status       ENUM('Active','Closed') NOT NULL DEFAULT 'Active',
  created_at   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_maintenance_vehicle FOREIGN KEY (vehicle_id) REFERENCES vehicles(id),
  KEY idx_maintenance_vehicle_id (vehicle_id),
  KEY idx_maintenance_status (status)
) ENGINE=InnoDB;

-- ---------------------------------------------------------------
-- FUEL LOGS
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS fuel_logs (
  id          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  vehicle_id  INT UNSIGNED NOT NULL,
  liters      DECIMAL(10,2) NOT NULL,
  cost        DECIMAL(12,2) NOT NULL,
  date        DATE NOT NULL,
  created_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_fuel_vehicle FOREIGN KEY (vehicle_id) REFERENCES vehicles(id),
  KEY idx_fuel_vehicle_id (vehicle_id),
  KEY idx_fuel_date (date)
) ENGINE=InnoDB;

-- ---------------------------------------------------------------
-- EXPENSES
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS expenses (
  id          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  vehicle_id  INT UNSIGNED NOT NULL,
  category    VARCHAR(100) NOT NULL,
  amount      DECIMAL(12,2) NOT NULL,
  date        DATE NOT NULL,
  created_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_expenses_vehicle FOREIGN KEY (vehicle_id) REFERENCES vehicles(id),
  KEY idx_expenses_vehicle_id (vehicle_id),
  KEY idx_expenses_date (date)
) ENGINE=InnoDB;
