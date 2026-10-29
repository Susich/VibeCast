# Keep Ktor/serialization metadata used at runtime.
-keepattributes *Annotation*, InnerClasses, Signature, Exceptions
-dontwarn io.ktor.**
-dontwarn org.slf4j.**
-keep class com.vibecast.shared.** { *; }
-keepclassmembers class kotlinx.serialization.json.** { *** Companion; }
