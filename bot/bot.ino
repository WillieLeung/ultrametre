#include <EEPROM.h>

int enA = 9; int in1 = 8; int in2 = 7;
int enB = 3; int in3 = 4; int in4 = 2;
int trigPin = 11; int echoPin = 12;

bool solanaTriggered = false;
unsigned long lastLogTime = 0;
float totalDistanceTravelled = 0.0;

void setup() {
  Serial.begin(9600);
  pinMode(enA, OUTPUT); pinMode(in1, OUTPUT); pinMode(in2, OUTPUT);
  pinMode(enB, OUTPUT); pinMode(in3, OUTPUT); pinMode(in4, OUTPUT);
  pinMode(trigPin, OUTPUT); pinMode(echoPin, INPUT);
  pinMode(13, OUTPUT);
  
  // LOAD DATA FROM MEMORY ON BOOT
  EEPROM.get(0, totalDistanceTravelled);
  if (isnan(totalDistanceTravelled) || totalDistanceTravelled < 0) {
    totalDistanceTravelled = 0;
  }
  
  digitalWrite(13, LOW);
}

long getSmoothDistance() {
  digitalWrite(trigPin, LOW); delayMicroseconds(2);
  digitalWrite(trigPin, HIGH); delayMicroseconds(10);
  digitalWrite(trigPin, LOW);
  long d = pulseIn(echoPin, HIGH, 20000);
  if (d <= 0) return 200;
  return d * 0.034 / 2;
}

void move(int sRight, int sLeft, int i1, int i2, int i3, int i4) {
  digitalWrite(in1, i1); digitalWrite(in2, i2);
  digitalWrite(in3, i3); digitalWrite(in4, i4);
  analogWrite(enA, sRight);
  analogWrite(enB, sLeft);
}

void loop() {
  if (Serial.available() > 0) {
    char data = Serial.read();
    if (data == 'F') {
      solanaTriggered = true;
      digitalWrite(13, HIGH);
    }
    if (data == 'S') {
      solanaTriggered = false;
      digitalWrite(13, LOW);
    }
    if (data == 'D') {
      // Send the distance to the Web UI
      Serial.print("TOTAL_DISTANCE_TRAVELLED: ");
      Serial.println(totalDistanceTravelled);
    }
    if (data == 'C') {
      totalDistanceTravelled = 0;
      EEPROM.put(0, totalDistanceTravelled);
      Serial.println("DISTANCE_RESET");
    }
  }

  if (solanaTriggered) {
    long sensorDist = getSmoothDistance();
    
    if (millis() - lastLogTime >= 1000) {
      totalDistanceTravelled += 25.0; // Simulated distance per second
      EEPROM.put(0, totalDistanceTravelled);
      lastLogTime = millis();
    }

    if (sensorDist < 30 && sensorDist > 0) {
      move(0, 0, LOW, LOW, LOW, LOW); delay(200);
      move(155, 150, HIGH, LOW, HIGH, LOW); delay(400);
      move(185, 180, HIGH, LOW, LOW, HIGH); delay(400); 
    } else {
      move(250, 200, LOW, HIGH, LOW, HIGH); 
    }
  } else {
    move(0, 0, LOW, LOW, LOW, LOW);
  }
  delay(30);
}